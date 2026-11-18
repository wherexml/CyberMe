package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo"
	"strconv"
	"strings"
	"sync"
	"time"
)

// No arbitrary notification text, URL or command is accepted from a page.
// The server owns freshness and a durable at-most-once claim; native owns OS delivery.
type DesktopNotifications struct {
	mu          sync.Mutex
	last        string
	openMu      sync.Mutex
	pendingOpen string
}

func noticeAPI(method, path string, body any) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	r, err := (&Bridge{}).Request(ctx, method, "/api/native/notifications"+path, raw)
	if err != nil {
		return nil, err
	}
	if r.Status < 200 || r.Status >= 300 {
		return nil, errors.New("通知状态读取或保存失败，请重新读取")
	}
	var result map[string]any
	err = json.Unmarshal(r.Data, &result)
	return result, err
}
func (n *DesktopNotifications) Status() (map[string]any, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	s, e := noticeAPI("GET", "", nil)
	if e == nil {
		s["nativeStatus"] = n.last
		s["supported"] = mygo.NotificationsSupported()
	}
	return s, e
}
func (n *DesktopNotifications) show(id, body string) error {
	if !mygo.NotificationsSupported() {
		n.last = "unsupported"
		return errors.New("请使用已安装的 CyberMe 应用")
	}
	err := mygo.NewNotification(mygo.NotificationOptions{ID: id, Title: "CyberMe", Body: body, Group: "cyberme-insights"}).Show()
	n.last = "accepted"
	if err != nil {
		n.last = "failed"
		if errors.Is(err, mygo.ErrNotificationsDenied) {
			n.last = "denied"
			return errors.New("请在系统设置的通知中允许 CyberMe")
		}
	}
	return err
}
func (n *DesktopNotifications) Configure(enabled bool, version string) (map[string]any, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	s, err := noticeAPI("GET", "", nil)
	if err != nil {
		return nil, err
	}
	if s["version"] != version {
		return nil, errors.New("通知设置已更新，请重新读取")
	}
	if enabled && s["enabled"] != true {
		if err = n.show("cyberme-notification-setup", "系统通知测试：可以在这里接收新的洞察。"); err != nil {
			return nil, err
		}
	}
	return noticeAPI("PATCH", "", map[string]any{"enabled": enabled, "baseVersion": version})
}
func (n *DesktopNotifications) Test() error {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.show("cyberme-notification-test-"+strconv.FormatInt(time.Now().UnixNano(), 10), "系统通知测试：可以在这里接收新的洞察。")
}
func (n *DesktopNotifications) poll() {
	n.mu.Lock()
	defer n.mu.Unlock()
	s, err := noticeAPI("GET", "", nil)
	if err != nil || s["enabled"] != true {
		return
	}
	rows, _ := s["pending"].([]any)
	for _, row := range rows {
		r, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id, ok := r["id"].(string)
		if !ok {
			continue
		}
		body := "有新的洞察，点击查看。"
		switch {
		case strings.HasPrefix(id, "idea-insight-"):
		case strings.HasPrefix(id, "inbox-digest-"):
			body = "有新的洞察摘要，点击查看。"
		default:
			continue
		}
		claim, err := noticeAPI("POST", "/"+id+"/claim", map[string]any{})
		if err != nil || claim["claimed"] != true {
			continue
		}
		valid, err := noticeAPI("GET", "/"+id+"/validate", nil)
		if err != nil || valid["valid"] != true {
			_, _ = noticeAPI("POST", "/"+id+"/receipt", map[string]any{"status": "failed"})
			continue
		}
		// A successful Show means OS acceptance, never proof of visible presentation.
		err = n.show("cyberme-"+id, body)
		status := "accepted"
		if err != nil {
			status = "failed"
			if n.last == "denied" {
				status = "denied"
			}
		}
		_, _ = noticeAPI("POST", "/"+id+"/receipt", map[string]any{"status": status})
		if err != nil {
			return
		}
	}
}
// Keep a cold-launch click until the workspace is ready to navigate.
func (n *DesktopNotifications) TakeOpen() string {
	n.openMu.Lock()
	defer n.openMu.Unlock()
	id := n.pendingOpen
	n.pendingOpen = ""
	return id
}

func (n *DesktopNotifications) listen(window func() *mygo.Window) {
	mygo.App.OnNotificationClick(func(id string) {
		if !strings.HasPrefix(id, "cyberme-") {
			return
		}
		n.openMu.Lock()
		n.pendingOpen = strings.TrimPrefix(id, "cyberme-")
		n.openMu.Unlock()
		if w := window(); w != nil && !w.IsDestroyed() {
			mygo.App.Show()
			w.Restore()
			w.Show()
			w.Focus()
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, _ = w.Page().EvalContext(ctx, `window.dispatchEvent(new Event('cyberme-open-insights'))`)
			}()
		}
	})
}

func (n *DesktopNotifications) start() {
	go func() {
		timer := time.NewTicker(10 * time.Second)
		defer timer.Stop()
		for range timer.C {
			n.poll()
		}
	}()
}
