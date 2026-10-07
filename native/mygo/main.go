package main

import (
	"context"
	"embed"
	"github.com/egoist/mygo"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"sync"
)

//go:embed all:assets
var assets embed.FS
var hidden = mygo.NewEvent[bool]("owner-hidden")

type Qualification struct {
	mu          sync.Mutex
	generation  int
	visible     bool
	permissions int
}

func (q *Qualification) State() map[string]any {
	q.mu.Lock()
	defer q.mu.Unlock()
	return map[string]any{"visible": q.visible, "generation": q.generation, "businessBridge": false, "permissionRequests": q.permissions}
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
	q.generation++
	q.visible = visible
	q.mu.Unlock()
	if !visible {
		_ = hidden.Emit(w, true)
	}
}
func localURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "mygo" && u.Host == "localhost" && u.User == nil
}
func main() {
	lock, err := singleInstance()
	if err != nil {
		log.Fatal(err)
	}
	defer lock.Close()
	web, err := fs.Sub(assets, "assets")
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.SetName("OpsTwins MyGO Preview")
	handler := mygo.FileServer(web)
	mygo.Protocol.Handle("mygo", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		handler.ServeHTTP(w, r)
	}))
	q := &Qualification{visible: true}
	mygo.Bind(q)
	mygo.Bind(&Bridge{})
	mygo.App.WhenReady(func() {
		w := mygo.NewWindow(mygo.WindowOptions{Title: "OpsTwins MyGO Preview", URL: "/pilot.html", Width: 1000, Height: 700, MinWidth: 640, MinHeight: 400, TitleBarStyle: mygo.TitleBarHidden, TrafficLightPosition: &mygo.Point{X: 16, Y: 18}})
		w.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			if !localURL(e.URL) {
				e.PreventDefault()
			}
		})
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
		w.OnHide(func() { q.owner(w, false) })
		w.OnMinimize(func() { q.owner(w, false) })
		w.OnShow(func() { q.owner(w, true) })
		w.OnRestore(func() { q.owner(w, true) })
		w.OnClosed(func() { q.owner(w, false) })
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
