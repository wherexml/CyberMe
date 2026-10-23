package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// Fixed at build time. Web content cannot select executables, update paths or URLs.
var updateSourceRoot string
var updateMu sync.Mutex
var updateInstalling bool

type DesktopUpdate struct{}

func updateCommand(action string) (map[string]any, error) {
	if runtimeMode != "standalone" || updateSourceRoot == "" {
		return map[string]any{"status": "unavailable"}, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	app := filepath.Clean(filepath.Join(filepath.Dir(exe), "../.."))
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, runtimeNode, filepath.Join(runtimeCodeRoot, "scripts/cyberme-updater.mjs"), action, app, updateSourceRoot, strconv.Itoa(os.Getpid()))
	raw, err := cmd.Output()
	if err != nil {
		return nil, errors.New("update_helper_failed")
	}
	var result map[string]any
	if json.Unmarshal(raw, &result) != nil {
		return nil, errors.New("update_response_invalid")
	}
	return result, nil
}
func (*DesktopUpdate) Check() (map[string]any, error) {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updateInstalling {
		return map[string]any{"status": "prepared"}, nil
	}
	return updateCommand("check")
}
func (*DesktopUpdate) Install() (map[string]any, error) {
	updateMu.Lock()
	defer updateMu.Unlock()
	if updateInstalling {
		return nil, errors.New("update_in_progress")
	}
	result, err := updateCommand("prepare")
	if err != nil {
		return nil, err
	}
	if result["status"] == "prepared" {
		updateInstalling = true
		go func() {
			time.Sleep(800 * time.Millisecond)
			mygo.App.Quit()
			time.Sleep(40 * time.Second)
			updateMu.Lock()
			updateInstalling = false
			updateMu.Unlock()
		}()
	}
	return result, nil
}
