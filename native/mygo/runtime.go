package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Set at build time: Finder does not inherit an interactive shell's PATH.
var runtimeNode string
var runtimeMode string
var runtimeCodeRoot string

func configureRuntime() error {
	if runtimeMode != "standalone" {
		runtimeCodeRoot = workspaceRoot
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	runtimeCodeRoot = filepath.Clean(filepath.Join(filepath.Dir(executable), "../Resources/runtime"))
	runtimeNode = filepath.Join(runtimeCodeRoot, "bin/node")
	workspaceRoot = filepath.Join(home, "Library/Application Support/OpsTwins")
	if err = os.MkdirAll(workspaceRoot, 0700); err != nil {
		return err
	}
	actual, err := filepath.EvalSymlinks(workspaceRoot)
	if err != nil || actual != workspaceRoot {
		return errors.New("invalid_standalone_state_path")
	}
	st, err := os.Stat(workspaceRoot)
	if err != nil {
		return err
	}
	native, ok := st.Sys().(*syscall.Stat_t)
	if !ok || native.Uid != uint32(os.Getuid()) || st.Mode().Perm() != 0700 {
		return errors.New("invalid_standalone_state_permissions")
	}
	return nil
}

var runtimeMu sync.Mutex
var runtimeChecked time.Time
var runtimeFailure error

func runtimeHealth(port string, token string) bool {
	client := http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequest("GET", "http://127.0.0.1:"+port+"/api/health", nil)
	if token != "" {
		req.Header.Set("X-OpsTwins-Pilot", token)
	}
	res, err := client.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var body struct {
		OK          bool   `json:"ok"`
		Name        string `json:"name"`
		Database    string `json:"database"`
		RuntimeMode string `json:"runtimeMode"`
	}
	return res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(&body) == nil && body.OK && body.Name == "OpsTwin Advance" && body.Database == "independent" && (runtimeMode != "standalone" || body.RuntimeMode == "standalone")
}
func runtimeGatewayHealthy() bool {
	link, err := readServiceLink()
	return err == nil && runtimeHealth(servicePort, link.Token)
}
func runtimePortBusy(port string) bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, 250*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
func runtimePrivateFile(root *os.Root, name string) (*os.File, error) {
	f, err := root.OpenFile(name, os.O_CREATE|os.O_RDWR|os.O_APPEND|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	s, ok := st.Sys().(*syscall.Stat_t)
	if !ok || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || s.Uid != uint32(os.Getuid()) || s.Nlink != 1 {
		f.Close()
		return nil, errors.New("unsafe_runtime_file")
	}
	return f, nil
}
func runtimeStart(root *os.Root, name, entry string) error {
	if !filepath.IsAbs(runtimeNode) {
		return errors.New("node_runtime_not_configured")
	}
	if st, err := os.Stat(runtimeNode); err != nil || !st.Mode().IsRegular() || st.Mode()&0111 == 0 {
		return errors.New("node_runtime_missing")
	}
	if st, err := os.Stat(filepath.Join(runtimeCodeRoot, entry)); err != nil || !st.Mode().IsRegular() {
		return errors.New("workspace_runtime_missing")
	}
	logFile, err := runtimePrivateFile(root, name+".log")
	if err != nil {
		return err
	}
	defer logFile.Close()
	if st, _ := logFile.Stat(); st.Size() > 2<<20 {
		if err = logFile.Truncate(0); err != nil {
			return err
		}
	}
	args := []string{entry}
	if name == "api" {
		args = []string{"--import", "tsx", entry}
	}
	cmd := exec.Command(runtimeNode, args...)
	cmd.Dir = runtimeCodeRoot
	// Do not inherit fixture ports, alternate data roots or test-only configuration.
	for _, v := range os.Environ() {
		if !strings.HasPrefix(v, "OPSTWIN_") && !strings.HasPrefix(v, "NODE_OPTIONS=") && !strings.HasPrefix(v, "NODE_PATH=") && !strings.HasPrefix(v, "PATH=") {
			cmd.Env = append(cmd.Env, v)
		}
	}
	cmd.Env = append(cmd.Env, "PATH="+filepath.Dir(runtimeNode)+":"+os.Getenv("HOME")+"/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
	cmd.Env = append(cmd.Env, "OPSTWIN_NO_BACKGROUND=1", "OPSTWIN_INBOX_BACKGROUND=1", "OPSTWIN_CONNECTION_BACKGROUND=1", "OPSTWIN_API_PORT=46110")
	if runtimeMode == "standalone" {
		cmd.Env = append(cmd.Env, "OPSTWIN_STANDALONE=1")
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err = cmd.Start(); err != nil {
		return errors.New("runtime_spawn_failed")
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
func ensureDesktopRuntime() (result error) {
	if clientScope != "mygo-workspace" {
		return nil
	}
	runtimeMu.Lock()
	defer runtimeMu.Unlock()
	if time.Since(runtimeChecked) < 2*time.Second {
		return runtimeFailure
	}
	defer func() { runtimeChecked = time.Now(); runtimeFailure = result }()
	p, err := scopeRoot("mygo-runtime")
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(p)
	if err != nil {
		return err
	}
	defer root.Close()
	lock, err := runtimePrivateFile(root, "startup.lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	deadline := time.Now().Add(30 * time.Second)
	for syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		if time.Now().After(deadline) {
			return errors.New("runtime_start_busy")
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	for _, service := range []struct {
		name, port, entry string
		healthy           func() bool
	}{
		{"api", "46110", "server/src/index.ts", func() bool { return runtimeHealth("46110", "") }},
		{"gateway", servicePort, "scripts/mygo-workspace-gateway.mjs", runtimeGatewayHealthy},
	} {
		if service.healthy() {
			continue
		}
		// A listener may still be starting. Give it time; never terminate it or start another writer.
		if !runtimePortBusy(service.port) {
			if err = runtimeStart(root, service.name, service.entry); err != nil {
				return err
			}
		}
		ready := false
		for time.Now().Before(deadline) {
			if service.healthy() {
				ready = true
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
		if !ready {
			return errors.New(service.name + "_startup_failed_or_port_occupied")
		}
	}
	runtimeChecked = time.Now()
	return nil
}
