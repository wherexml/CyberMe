package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"opstwin-advance/native/mygo/internal/updatefeed"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

var updateSourceRoot string

//go:embed update-policy.json
var updatePolicy []byte
var updateMu sync.Mutex
var updateData = updateState{Status: "idle"}

type updateState struct {
	Status     string               `json:"status"`
	Current    map[string]any       `json:"current,omitempty"`
	Available  *updatefeed.Manifest `json:"available,omitempty"`
	Ready      bool                 `json:"ready"`
	Downloaded int64                `json:"downloaded"`
	Total      int64                `json:"total"`
	Error      string               `json:"error,omitempty"`
	busy       bool
	cancel     context.CancelFunc
}
type DesktopUpdate struct{}

func updateSnapshot() map[string]any {
	raw, _ := json.Marshal(updateData)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}
func (*DesktopUpdate) Status() map[string]any {
	updateMu.Lock()
	defer updateMu.Unlock()
	return updateSnapshot()
}
func updateApp() (string, error) {
	exe, e := os.Executable()
	return filepath.Clean(filepath.Join(filepath.Dir(exe), "../..")), e
}
func updateCommand(ctx context.Context, action, source, extra string) (map[string]any, error) {
	if runtimeMode != "standalone" || updateSourceRoot == "" {
		return map[string]any{"status": "unavailable"}, nil
	}
	app, e := updateApp()
	if e != nil {
		return nil, e
	}
	if extra == "" {
		extra = strconv.Itoa(os.Getpid())
	}
	cmd := exec.CommandContext(ctx, runtimeNode, filepath.Join(runtimeCodeRoot, "scripts/cyberme-updater.mjs"), action, app, source, extra)
	raw, e := cmd.Output()
	if e != nil {
		return nil, errors.New("update_helper_failed")
	}
	var r map[string]any
	if json.Unmarshal(raw, &r) != nil {
		return nil, errors.New("update_response_invalid")
	}
	return r, nil
}
func configureUpdates() {
	// Retain the existing developer-local channel only when it belongs to this user.
	// Public installations otherwise use their own Application Support directory.
	if runtimeMode == "standalone" {
		st, err := os.Lstat(updateSourceRoot)
		usable := false
		if err == nil && st.IsDir() && st.Mode()&os.ModeSymlink == 0 {
			owner, ok := st.Sys().(*syscall.Stat_t)
			real, e := filepath.EvalSymlinks(updateSourceRoot)
			usable = ok && owner.Uid == uint32(os.Getuid()) && e == nil && real == updateSourceRoot
		}
		if !usable {
			updateSourceRoot = filepath.Join(workspaceRoot, ".local", "updates")
		}
	}

	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		updateMu.Lock()
		defer updateMu.Unlock()
		if updateData.cancel != nil {
			updateData.cancel()
		}
	})
}
func (*DesktopUpdate) Check() map[string]any {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updateData.busy || updateData.Ready {
		return updateSnapshot()
	}
	updateData.busy = true
	updateData.Status = "checking"
	updateData.Error = ""
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		local, e := updateCommand(ctx, "check", updateSourceRoot, "")
		var m *updatefeed.Manifest
		var client updatefeed.Client
		_ = json.Unmarshal(updatePolicy, &client)
		if e == nil && local["status"] == "unavailable" {
			updateMu.Lock()
			updateData.Status = "unavailable"
			updateData.busy = false
			updateMu.Unlock()
			return
		}
		current, _ := local["current"].(map[string]any)
		if e == nil && local["status"] == "error" {
			code, _ := local["error"].(string)
			if code == "" {
				code = "update_helper_failed"
			}
			e = errors.New(code)
		}
		if e == nil && local["status"] == "available" {
			a, _ := local["available"].(map[string]any)
			version, _ := a["version"].(string)
			build, _ := a["build"].(string)
			epoch, _ := a["dataEpoch"].(string)
			if version == "" || build == "" || epoch == "" {
				e = errors.New("update_response_invalid")
			} else {
				m = &updatefeed.Manifest{Version: version, Build: build, DataEpoch: epoch}
			}
		} else if e == nil {
			m, e = client.Check(ctx)
			if e == nil {
				if current == nil {
					e = errors.New("installed_version_unavailable")
				} else if m.DataEpoch != current["dataEpoch"] {
					e = errors.New("incompatible_data")
				} else {
					var newer bool
					version, _ := current["version"].(string)
					build, _ := current["build"].(string)
					newer, e = updatefeed.Newer(m, version, build)
					if !newer {
						m = nil
					}
				}
			}
		}
		updateMu.Lock()
		defer updateMu.Unlock()
		updateData.busy = false
		if current != nil {
			updateData.Current = current
		}
		if e != nil {
			updateData.Status = "error"
			updateData.Error = updatefeed.Code(e)
			return
		}
		updateData.Available = m
		updateData.Ready = m != nil && m.URL == ""
		updateData.Status = "current"
		if m != nil {
			updateData.Status = "available"
		}
		if updateData.Ready {
			updateData.Status = "ready"
		}
	}()
	return updateSnapshot()
}
func (*DesktopUpdate) Download() map[string]any {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updateData.busy || updateData.Available == nil || updateData.Ready {
		return updateSnapshot()
	}
	m := *updateData.Available
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	updateData.cancel = cancel
	updateData.busy = true
	updateData.Status = "downloading"
	updateData.Error = ""
	updateData.Downloaded = 0
	updateData.Total = m.Size
	go func() {
		err := prepareDownload(ctx, &m)
		cancel()
		updateMu.Lock()
		defer updateMu.Unlock()
		updateData.cancel = nil
		updateData.busy = false
		if err != nil {
			updateData.Status = "error"
			updateData.Error = updatefeed.Code(err)
			if errors.Is(err, context.Canceled) {
				updateData.Status = "available"
				updateData.Error = ""
			}
			return
		}
		updateData.Status = "ready"
		updateData.Ready = true
	}()
	return updateSnapshot()
}
func prepareDownload(ctx context.Context, m *updatefeed.Manifest) error {
	if err := os.MkdirAll(updateSourceRoot, 0700); err != nil {
		return err
	}
	real, err := filepath.EvalSymlinks(updateSourceRoot)
	if err != nil || real != updateSourceRoot {
		return errors.New("unsafe_update_path")
	}
	work, err := os.MkdirTemp(updateSourceRoot, ".download-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	archive := filepath.Join(work, "archive.tar.gz")
	last := time.Time{}
	err = updatefeed.Download(ctx, m, archive, func(done, total int64) {
		if done != total && time.Since(last) < 100*time.Millisecond {
			return
		}
		last = time.Now()
		updateMu.Lock()
		updateData.Downloaded = done
		updateData.Total = total
		updateMu.Unlock()
	})
	if err != nil {
		return err
	}
	updateMu.Lock()
	updateData.Status = "verifying"
	updateMu.Unlock()
	if err = updatefeed.Extract(ctx, archive, filepath.Join(work, "extracted")); err != nil {
		return err
	}
	candidate := filepath.Join(work, "extracted", "CyberMe.app")
	r, err := updateCommand(ctx, "check", filepath.Dir(candidate), "")
	if err != nil {
		return err
	}
	a, _ := r["available"].(map[string]any)
	if r["status"] != "available" || a["version"] != m.Version || a["build"] != m.Build || a["dataEpoch"] != m.DataEpoch {
		return errors.New("candidate_mismatch")
	}
	if err = exec.CommandContext(ctx, "/usr/sbin/spctl", "--assess", "--type", "execute", candidate).Run(); err != nil {
		return errors.New("notarization_rejected")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	// Publication is a short locked transaction. Cancellation is only offered during transfer.
	publishCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	r, err = updateCommand(publishCtx, "publish", updateSourceRoot, candidate)
	if err != nil {
		return err
	}
	if r["status"] != "ready" {
		return errors.New("publish_failed")
	}
	return nil
}
func (*DesktopUpdate) Cancel() map[string]any {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updateData.Status == "downloading" && updateData.cancel != nil {
		updateData.cancel()
	}
	return updateSnapshot()
}
func (*DesktopUpdate) Install() (map[string]any, error) {
	updateMu.Lock()
	if updateData.busy {
		r := updateSnapshot()
		updateMu.Unlock()
		return r, nil
	}
	updateData.busy = true
	updateData.Status = "installing"
	updateMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Second)
	defer cancel()
	r, e := updateCommand(ctx, "prepare", updateSourceRoot, "")
	updateMu.Lock()
	defer updateMu.Unlock()
	if e != nil {
		updateData.busy = false
		updateData.Status = "error"
		updateData.Error = updatefeed.Code(e)
		return updateSnapshot(), nil
	}
	if r["status"] == "prepared" {
		updateData.Status = "prepared"
		go func() {
			time.Sleep(800 * time.Millisecond)
			mygo.App.Quit()
			time.Sleep(40 * time.Second)
			updateMu.Lock()
			updateData.busy = false
			updateData.Status = "ready"
			updateMu.Unlock()
		}()
	} else {
		updateData.busy = false
		code, _ := r["error"].(string)
		updateData.Error = code
		if code == "runtime_busy" || code == "runtime_child_busy" || code == "runtime_process_busy" {
			updateData.Status = "waiting"
		} else {
			updateData.Status, _ = r["status"].(string)
		}
		if updateData.Status == "current" || updateData.Status == "none" {
			updateData.Ready = false
			updateData.Available = nil
		}
	}
	return updateSnapshot(), nil
}
