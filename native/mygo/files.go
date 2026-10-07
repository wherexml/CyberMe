package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

type DesktopFiles struct{ Owner *Qualification }

func (d *DesktopFiles) generation() int {
	d.Owner.mu.Lock()
	defer d.Owner.mu.Unlock()
	return d.Owner.generation
}
func (d *DesktopFiles) valid(ctx context.Context, g int) bool {
	d.Owner.mu.Lock()
	defer d.Owner.mu.Unlock()
	return ctx.Err() == nil && d.Owner.visible && d.Owner.generation == g
}
func fileAllowed(path string) bool {
	real, err := filepath.EvalSymlinks(path)
	if err != nil || real != filepath.Clean(path) {
		return false
	}
	bridgeMu.Lock()
	state, err := readState()
	bridgeMu.Unlock()
	if err != nil {
		return false
	}
	var policy struct {
		Filesystem struct {
			Blocked []string `json:"blocked"`
		} `json:"filesystem"`
	}
	if raw := state.Drafts["html:opstwins-device-study-v1"]; raw != "" {
		if json.Unmarshal([]byte(raw), &policy) != nil {
			return false
		}
	}
	for _, p := range policy.Filesystem.Blocked {
		clean := filepath.Clean(p)
		if actual, e := filepath.EvalSymlinks(clean); e == nil {
			clean = actual
		}
		if clean == string(filepath.Separator) || real == clean || strings.HasPrefix(real, clean+string(filepath.Separator)) {
			return false
		}
	}
	return true
}
func (d *DesktopFiles) ChooseFolder(ctx context.Context) (string, error) {
	g := d.generation()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "选择屏蔽文件夹", Directory: true})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", nil
	}
	if !d.valid(ctx, g) {
		return "", errors.New("owner_changed")
	}
	return paths[0], nil
}
func (d *DesktopFiles) Upload(ctx context.Context) (json.RawMessage, error) {
	g := d.generation()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "添加聊天附件"})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return json.RawMessage(`{"cancelled":true}`), nil
	}
	if !d.valid(ctx, g) || !fileAllowed(paths[0]) {
		return nil, errors.New("file_access_denied")
	}
	f, err := os.OpenFile(paths[0], os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("file_read_failed")
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() > 64<<20 {
		return nil, errors.New("file_size_or_type")
	}
	raw, err := io.ReadAll(io.LimitReader(f, (64<<20)+1))
	if err != nil || len(raw) > 64<<20 || !d.valid(ctx, g) || !fileAllowed(paths[0]) {
		return nil, errors.New("file_read_cancelled")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	headers := make(textproto.MIMEHeader)
	filename := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\r", "_", "\n", "_").Replace(filepath.Base(paths[0]))
	headers.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(paths[0])))
	if contentType == "" {
		contentType = http.DetectContentType(raw)
	}
	headers.Set("Content-Type", contentType)
	part, err := writer.CreatePart(headers)
	if err != nil {
		return nil, err
	}
	if _, err = part.Write(raw); err != nil {
		return nil, err
	}
	writer.Close()
	link, err := serviceLink()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", serviceURL()+"/api/files", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-OpsTwins-Pilot", link.Token)
	if !d.valid(ctx, g) {
		return nil, errors.New("owner_changed")
	}
	client := http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, err := client.Do(req)
	if err != nil {
		return nil, errors.New("upload_unconfirmed")
	}
	defer r.Body.Close()
	result, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil || !json.Valid(result) {
		return nil, errors.New("upload_invalid_response")
	}
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return nil, errors.New("upload_rejected")
	}
	if !d.valid(ctx, g) {
		return nil, errors.New("owner_changed_after_upload")
	}
	return result, nil
}

var fileRoute = regexp.MustCompile(`^/(files/[A-Za-z0-9_-]+|api/wechat/attachments/[A-Za-z0-9_-]+|api/feishu/sync/assets/[A-Za-z0-9_-]+)$`)

func (d *DesktopFiles) Save(ctx context.Context, path, name string) (map[string]any, error) {
	return d.save(ctx, path, name, "")
}
func (d *DesktopFiles) SaveVerified(ctx context.Context, path, name, expectedHash string) (map[string]any, error) {
	if !regexp.MustCompile(`^[a-fA-F0-9]{64}$`).MatchString(expectedHash) {
		return nil, errors.New("file_digest_required")
	}
	return d.save(ctx, path, name, expectedHash)
}
func (d *DesktopFiles) save(ctx context.Context, path, name, expectedHash string) (map[string]any, error) {
	if !fileRoute.MatchString(path) {
		return nil, errors.New("file_route_denied")
	}
	g := d.generation()
	target, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "保存文件", DefaultPath: filepath.Base(name)})
	if err != nil {
		return nil, err
	}
	if target == "" {
		return map[string]any{"cancelled": true}, nil
	}
	parent := filepath.Dir(target)
	if !d.valid(ctx, g) || !fileAllowed(parent) {
		return nil, errors.New("file_access_denied")
	}
	root, err := os.OpenRoot(parent)
	if err != nil {
		return nil, errors.New("save_directory_invalid")
	}
	defer root.Close()
	if _, err := root.Lstat(filepath.Base(target)); !os.IsNotExist(err) {
		return nil, errors.New("file_exists_choose_another_name")
	}
	link, err := serviceLink()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", serviceURL()+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-OpsTwins-Pilot", link.Token)
	client := http.Client{Timeout: 90 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	r, err := client.Do(req)
	if err != nil {
		return nil, errors.New("download_failed")
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, errors.New("file_unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (64<<20)+1))
	if err != nil || len(body) > 64<<20 || !d.valid(ctx, g) || !fileAllowed(parent) {
		return nil, errors.New("download_cancelled")
	}
	if expectedHash != "" {
		digest := sha256.Sum256(body)
		if !strings.EqualFold(hex.EncodeToString(digest[:]), expectedHash) {
			return nil, errors.New("file_digest_mismatch")
		}
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	temp := ".opstwins-" + hex.EncodeToString(nonce)
	f, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, errors.New("save_failed")
	}
	defer root.Remove(temp)
	_, err = f.Write(body)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return nil, errors.New("save_failed")
	}
	if !d.valid(ctx, g) || !fileAllowed(parent) {
		return nil, errors.New("owner_changed")
	}
	if err = root.Link(temp, filepath.Base(target)); err != nil {
		return nil, errors.New("save_conflict")
	}
	if dir, e := root.Open("."); e == nil {
		syncErr := dir.Sync()
		dir.Close()
		if syncErr != nil {
			return nil, errors.New("save_durability_unconfirmed")
		}
	} else {
		return nil, errors.New("save_durability_unconfirmed")
	}
	return map[string]any{"saved": true, "bytes": len(body), "name": filepath.Base(target)}, nil
}
func (d *DesktopFiles) OpenExternal(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil {
		return errors.New("url_not_allowed")
	}
	allowed := u.Scheme == "https" && u.Host != "" || u.Scheme == "x-apple.systempreferences" && u.Opaque == "com.apple.preference.security" && regexp.MustCompile(`^Privacy_[A-Za-z]+$`).MatchString(u.RawQuery)
	if !allowed {
		return errors.New("url_not_allowed")
	}
	return mygo.Shell.OpenExternal(raw)
}

func (d *DesktopFiles) Copy(ctx context.Context, text string) error {
	if !d.valid(ctx, d.generation()) {
		return errors.New("owner_changed")
	}
	if len(text) > 4<<20 {
		return errors.New("clipboard_too_large")
	}
	mygo.Clipboard.WriteText(text)
	return nil
}
