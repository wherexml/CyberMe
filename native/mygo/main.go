package main

import (
	"context"
	"embed"
	"github.com/egoist/mygo"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

//go:embed all:assets
var assets embed.FS
var hidden = mygo.NewEvent[bool]("owner-hidden")
var shown = mygo.NewEvent[bool]("owner-visible")

type Qualification struct {
	mu          sync.Mutex
	generation  int
	visible     bool
	permissions int
}

func (q *Qualification) State() map[string]any {
	q.mu.Lock()
	defer q.mu.Unlock()
	return map[string]any{"visible": q.visible, "generation": q.generation, "businessBridge": true, "permissionRequests": q.permissions}
}
func (q *Qualification) ChooseFile(ctx context.Context) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "公开资格验证：选择或取消（不会读取文件）"})
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "已取消，没有读取文件", nil
	}
	return "已选择，没有读取文件", nil
}
func (q *Qualification) owner(w *mygo.Window, visible bool) {
	q.mu.Lock()
	if q.visible == visible {
		q.mu.Unlock()
		return
	}
	q.generation++
	q.visible = visible
	q.mu.Unlock()
	if !visible {
		_ = hidden.Emit(w, true)
	} else {
		_ = shown.Emit(w, true)
	}
}
func localURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "mygo" && u.Host == "localhost" && u.User == nil
}
func main() {
	if err := configureRuntime(); err != nil { log.Fatal(err) }
	lock, err := singleInstance()
	if err != nil {
		log.Fatal(err)
	}
	defer lock.Close()
	go func() { if err := ensureDesktopRuntime(); err != nil { log.Printf("desktop startup: %v", err) } }()
	web, err := fs.Sub(assets, "assets")
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.SetName("CyberMe")
	handler := mygo.FileServer(web)
	mygo.Protocol.Handle("mygo", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/files/") {
			productProxy(w, r)
			return
		}
		handler.ServeHTTP(w, r)
	}))
	q := &Qualification{visible: true}
	mygo.Bind(q)
	mygo.Bind(&Bridge{})
	mygo.Bind(&DesktopUpdate{})
	configureUpdates()
	mygo.Bind(&DesktopFiles{Owner: q})
	mygo.App.WhenReady(func() {
		w := mygo.NewWindow(mygo.WindowOptions{Title: "CyberMe", URL: "/desktop.html", Width: 1000, Height: 700, MinWidth: 640, MinHeight: 400, TitleBarStyle: mygo.TitleBarHidden, TrafficLightPosition: &mygo.Point{X: 16, Y: 18}})
		w.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			if !localURL(e.URL) {
				e.PreventDefault()
			}
		})
		w.Page().OnWillDownload(func(e *mygo.DownloadEvent) { e.PreventDefault() })
		w.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		w.Page().SetPermissionHandler(func(r mygo.PermissionRequest) bool {
			q.mu.Lock()
			q.permissions++
			q.mu.Unlock()
			if !localURL(r.Origin) {
				return false
			}
			for _, p := range r.Permissions {
				if p != mygo.PermissionMicrophone {
					return false
				}
			}
			return true
		})
		mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Label: "CyberMe", Submenu: []*mygo.MenuItem{{Role: mygo.RoleAbout}, mygo.Separator(), {Label: "隐藏 CyberMe", Accelerator: "Cmd+H", Click: func(_ *mygo.MenuItem, _ *mygo.Window) { q.owner(w, false); mygo.App.Hide() }}, {Label: "显示 CyberMe", Click: func(_ *mygo.MenuItem, _ *mygo.Window) {
				if !w.IsDestroyed() {
					mygo.App.Show()
					w.Restore()
					w.Show()
					w.Focus()
				}
			}}, mygo.Separator(), {Role: mygo.RoleQuit}}},
			{Role: mygo.RoleEditMenu}, {Role: mygo.RoleWindowMenu},
		}))
		mygo.App.OnActivate(func(_ bool) {
			if !w.IsDestroyed() {
				mygo.App.Show()
				w.Restore()
				w.Show()
				w.Focus()
			}
		})
		mygo.App.OnDidResignActive(func() {
			if mygo.App.IsHidden() {
				q.owner(w, false)
			}
		})
		mygo.App.OnDidBecomeActive(func() { q.owner(w, !mygo.App.IsHidden() && !w.IsDestroyed() && w.IsVisible() && !w.IsMinimized()) })
		w.OnHide(func() { q.owner(w, false) })
		w.OnMinimize(func() { q.owner(w, false) })
		w.OnShow(func() { q.owner(w, !mygo.App.IsHidden() && !w.IsDestroyed() && w.IsVisible() && !w.IsMinimized()) })
		w.OnRestore(func() { q.owner(w, !mygo.App.IsHidden() && !w.IsDestroyed() && w.IsVisible() && !w.IsMinimized()) })
		w.OnClosed(func() { q.owner(w, false) })
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
