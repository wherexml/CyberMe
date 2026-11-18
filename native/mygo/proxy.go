package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Fixed product namespace. Import and arbitrary URL/path forwarding are never exposed.
var productPath = regexp.MustCompile(`^/(api/(health|bootstrap|diagnostics|agent|task-agents|chat|conversations|inbox|inbox-source-rules|ideas|tasks|projects|memories|settings|connections|feishu|wechat|sources|source-message-assets|runs|messages|activities|activity|artifacts|files|voice|calendar|automations|autonomous-dispatches|notifications|workspace|native|pilot|desktop)(/[^\\]*)?|files/[A-Za-z0-9_-]+)$`)

var skillsPath = regexp.MustCompile(`^/api/skills(/skill-[0-9a-f]{24})?$`)

func allowedProduct(method, path string) bool {
	if strings.HasPrefix(path, "/api/attention/") {
		return (method == "POST" && (path == "/api/attention/strategy" || path == "/api/attention/actions")) ||
			(method == "GET" && regexp.MustCompile(`^/api/attention/actions/[A-Za-z0-9_-]+$`).MatchString(path))
	}
	if path == "/api/memory-library/people" {
		return method == "GET"
	}
	// Follow-up listing/status are read-only; tick is local-worker only. Task-bound follow-up
	// routes (/api/tasks/:id/follow-up...) are covered by the existing tasks namespace.
	if path == "/api/follow-ups" || path == "/api/follow-ups/status" {
		return method == "GET"
	}
	// Skills catalog is read-only: exact list and skill-<24 hex> detail only (server/src/skill-catalog.ts).
	if path == "/api/skills" || strings.HasPrefix(path, "/api/skills/") {
		return method == "GET" && skillsPath.MatchString(path)
	}
	if strings.HasPrefix(path, "/api/ideas-console/") {
		return method == "GET" && regexp.MustCompile(`^/api/ideas-console/(capabilities|intents|runs)(/[A-Za-z0-9_-]+)?$`).MatchString(path)
	}
	if path == "/api/native/events" || !productPath.MatchString(path) || strings.Contains(path, "..") || strings.ContainsAny(path, "\\\x00\r\n") {
		return false
	}
	switch method {
	case "GET", "POST", "PATCH", "DELETE", "PUT":
		return true
	}
	return false
}
func serviceLink() (Link, error) {
	if err := ensureDesktopRuntime(); err != nil {
		return Link{}, err
	}
	return readServiceLink()
}
func readServiceLink() (Link, error) {
	raw, err := privateReadScope(serviceScope, "connection.json", 4096)
	if err != nil {
		return Link{}, errors.New("service_not_connected")
	}
	var link Link
	if json.Unmarshal(raw, &link) != nil || link.Port != expectedPort() || len(link.Token) != 64 {
		return link, errors.New("service_binding_invalid")
	}
	return link, nil
}
func productProxy(w http.ResponseWriter, r *http.Request) {
	if !allowedProduct(r.Method, r.URL.Path) {
		http.Error(w, "route_not_allowed", 403)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (64<<20)+1))
	if err != nil || len(body) > 64<<20 {
		http.Error(w, "request_too_large", 413)
		return
	}
	link, err := serviceLink()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(503)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "desktop_startup_failed", "message": "本机服务未就绪，请重试连接。" + err.Error()})
		return
	}
	target := url.URL{Scheme: "http", Host: "127.0.0.1:" + servicePort, Path: r.URL.Path, RawQuery: r.URL.RawQuery}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		http.Error(w, "invalid_request", 400)
		return
	}
	for _, h := range []string{"Content-Type", "Range", "If-None-Match", "X-OpsTwins-Client", "X-OpsTwins-Agent"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	req.Header.Set("X-OpsTwins-Pilot", link.Token)
	client := http.Client{Timeout: requestTimeout(r.Method, r.URL.Path), CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		http.Error(w, "service_unavailable", 503)
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
	if err != nil || len(data) > 64<<20 {
		http.Error(w, "response_too_large", 502)
		return
	}
	for _, h := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Content-Disposition"} {
		if v := response.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Uploaded documents must never become an executable same-origin page.
	if strings.Contains(response.Header.Get("Content-Type"), "text/html") || strings.Contains(response.Header.Get("Content-Type"), "image/svg+xml") {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	}
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(data)
}

// requestTimeout keeps POST /api/chat inside the server's two bounded phases (shared/chat-budgets.ts:
// prepare 150s + deep answer 150s + 45s lock/interrupt/settle overhead = 345s). Other routes keep 180s.
func requestTimeout(method, path string) time.Duration {
	if method == http.MethodPost && path == "/api/chat" {
		return 345 * time.Second
	}
	return 180 * time.Second
}
