package main

import (
	"context"
	"errors"
	"github.com/egoist/mygo"
	"time"
)

// WindowChrome only operates on the window that originated the bridge call.
type WindowChrome struct{}

func (*WindowChrome) Position(ctx context.Context) (map[string]int, error) {
	w := mygo.CallerWindow(ctx)
	if w == nil {
		return nil, errors.New("window unavailable")
	}
	x, y := w.Position()
	return map[string]int{"x": x, "y": y}, nil
}
func (*WindowChrome) Move(ctx context.Context, x, y int) error {
	w := mygo.CallerWindow(ctx)
	if w == nil {
		return errors.New("window unavailable")
	}
	if !w.IsFullScreen() {
		w.SetPosition(x, y)
	}
	return nil
}

// Menu callbacks run on the UI thread; evaluate the front surface asynchronously.
// A native close follows the existing red-button lifecycle only when no dialog owns it.
func closeFrontWindow(w *mygo.Window) {
	if w.IsDestroyed() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	handled, err := w.Page().EvalContext(ctx, `window.OpsTwinsWindowChrome?.closeFrontSurface() === true`)
	if err == nil && handled != true && !w.IsDestroyed() {
		w.Close()
	}
}
