package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"syscall"
	"time"
)

// workspaceRoot is set by the build script; no arbitrary path is accepted from a page.
var workspaceRoot string
var bridgeMu sync.Mutex
var routeRead = regexp.MustCompile(`^/api/(pilot/drafts/[A-Za-z0-9_-]+|health|conversations(?:/primary|/[A-Za-z0-9_-]+/messages)?|chat/requests/[A-Za-z0-9_-]+|chat/conversations/[A-Za-z0-9_-]+/unresolved|inbox(?:/query|/[A-Za-z0-9_-]+)?|settings/models(?:/tests/[A-Za-z0-9_-]+)?|messages/[A-Za-z0-9_-]+|runs/[A-Za-z0-9_-]+)$`)
var routeWrite = regexp.MustCompile(`^/api/(chat|conversations/side|inbox/[A-Za-z0-9_-]+/(draft|draft-candidate/apply|triage)|settings/models/test)$`)
var routePatch = regexp.MustCompile(`^/api/(inbox/[A-Za-z0-9_-]+|settings/models(?:/providers)?)$`)

type Bridge struct{}
type WireResponse struct {
	Status int             `json:"status"`
	Data   json.RawMessage `json:"data"`
}
type LocalState struct {
	Revision uint64                     `json:"revision"`
	Drafts   map[string]string          `json:"drafts"`
	Requests map[string]json.RawMessage `json:"requests"`
	Theme    string                     `json:"theme"`
}
type Link struct {
	Token string `json:"token"`
	Port  int    `json:"port"`
}

// Read through an already-open directory and reject symbolic/hard links and foreign owners.
func privateRead(name string, limit int64) ([]byte, error) {
	p, err := privateRoot()
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(p)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	native, ok := st.Sys().(*syscall.Stat_t)
	if !ok || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() > limit || native.Uid != uint32(os.Getuid()) || native.Nlink != 1 {
		return nil, errors.New("private_file_invalid")
	}
	return io.ReadAll(io.LimitReader(f, limit+1))
}
func privateRoot() (string, error) {
	if workspaceRoot == "" {
		return "", errors.New("workspace_unconfigured")
	}
	p := filepath.Join(workspaceRoot, ".local", "mygo-pilot-public-v2")
	if err := os.MkdirAll(p, 0700); err != nil {
		return "", errors.New("local_store_unavailable")
	}
	real, err := filepath.EvalSymlinks(p)
	if err != nil || real != p {
		return "", errors.New("local_store_path_invalid")
	}
	st, err := os.Stat(p)
	if err != nil || st.Mode().Perm() != 0700 {
		return "", errors.New("local_store_permissions_invalid")
	}
	native, ok := st.Sys().(*syscall.Stat_t)
	if !ok || native.Uid != uint32(os.Getuid()) {
		return "", errors.New("local_store_owner_invalid")
	}
	return p, nil
}
func readState() (LocalState, error) {
	empty := LocalState{Drafts: map[string]string{}, Requests: map[string]json.RawMessage{}, Theme: "light"}
	root, err := privateRoot()
	if err != nil {
		return empty, err
	}
	path := filepath.Join(root, "state.json")
	st, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() > 4<<20 {
		return empty, errors.New("local_state_invalid")
	}
	b, err := privateRead("state.json", 4<<20)
	if err != nil {
		return empty, errors.New("local_state_read_failed")
	}
	if json.Unmarshal(b, &empty) != nil || empty.Drafts == nil || empty.Requests == nil {
		return empty, errors.New("local_state_corrupt")
	}
	return empty, nil
}
func (b *Bridge) ReadState() (LocalState, error) {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	return readState()
}
func (b *Bridge) SaveState(next LocalState) (LocalState, error) {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	current, err := readState()
	if err != nil {
		return current, err
	}
	if next.Revision != current.Revision {
		return current, errors.New("local_state_conflict")
	}
	if len(next.Drafts) > 500 || len(next.Requests) > 500 {
		return current, errors.New("local_state_limit")
	}
	next.Revision++
	raw, err := json.Marshal(next)
	if err != nil || len(raw) > 4<<20 {
		return current, errors.New("local_state_limit")
	}
	root, err := privateRoot()
	if err != nil {
		return current, err
	}
	f, err := os.CreateTemp(root, ".state-*")
	if err != nil {
		return current, errors.New("local_save_failed")
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return current, errors.New("local_save_failed")
	}
	if err = os.Rename(name, filepath.Join(root, "state.json")); err != nil {
		return current, errors.New("local_save_failed")
	}
	dir, err := os.Open(root)
	if err != nil {
		return current, errors.New("local_save_unconfirmed")
	}
	defer dir.Close()
	if dir.Sync() != nil {
		return current, errors.New("local_save_unconfirmed")
	}
	return next, nil
}
func (b *Bridge) Request(ctx context.Context, method, path string, body json.RawMessage) (WireResponse, error) {
	response := WireResponse{}
	// Query syntax is bounded and parsed separately; paths cannot contain encoded separators or hosts.
	split := bytes.SplitN([]byte(path), []byte("?"), 2)
	route := string(split[0])
	if len(path) > 4096 || len(body) > 1<<20 || !(method == "GET" && routeRead.MatchString(route) || method == "POST" && routeWrite.MatchString(route) || method == "PATCH" && routePatch.MatchString(route)) {
		return response, errors.New("route_not_allowed")
	}
	root, err := privateRoot()
	if err != nil {
		return response, err
	}
	file := filepath.Join(root, "connection.json")
	st, err := os.Lstat(file)
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() > 4096 {
		return response, errors.New("service_not_connected")
	}
	raw, err := privateRead("connection.json", 4096)
	if err != nil {
		return response, errors.New("service_not_connected")
	}
	var link Link
	if json.Unmarshal(raw, &link) != nil || link.Port != 46310 || len(link.Token) != 64 {
		return response, errors.New("service_binding_invalid")
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://127.0.0.1:46310"+path, bytes.NewReader(body))
	if err != nil {
		return response, errors.New("invalid_request")
	}
	req.Header.Set("X-OpsTwins-Pilot", link.Token)
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 180 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, err := client.Do(req)
	if err != nil {
		return response, errors.New("service_unavailable")
	}
	defer r.Body.Close()
	data, err := io.ReadAll(io.LimitReader(r.Body, (4<<20)+1))
	if err != nil || len(data) > 4<<20 || !json.Valid(data) {
		return response, errors.New("invalid_service_response")
	}
	response.Status = r.StatusCode
	response.Data = data
	return response, nil
}

// Hold a process-wide lock for the full App lifetime; a second instance cannot race CAS writes.
func singleInstance() (*os.File, error) {
	p, err := privateRoot()
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(p)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile("app.lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, errors.New("app_lock_unavailable")
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	native, ok := st.Sys().(*syscall.Stat_t)
	if !ok || native.Uid != uint32(os.Getuid()) || native.Nlink != 1 || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 {
		f.Close()
		return nil, errors.New("app_lock_invalid")
	}
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		f.Close()
		return nil, errors.New("preview_already_running")
	}
	return f, nil
}
