// Real HTTP/archive integration acceptance; never installs an app.
package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"opstwin-advance/native/mygo/internal/updatefeed"
	"os"
	"path/filepath"
	"time"
)

func main() {
	out := os.Args[1]
	_ = os.MkdirAll(out, 0700)
	work, e := os.MkdirTemp(out, "http-fixture-")
	if e != nil {
		panic(e)
	}
	defer os.RemoveAll(work)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	data := []byte("CYBERME_PUBLIC_UPDATE_ARCHIVE_BYTES")
	hash := sha256.Sum256(data)
	base := "http://127.0.0.1:46472"
	m := updatefeed.Manifest{Version: "0.1.2", Build: "20", DataEpoch: "1", Size: int64(len(data)), SHA256: hex.EncodeToString(hash[:]), URL: base + "/archive"}
	payload, _ := json.Marshal(m)
	envelope := func(p []byte, sig []byte) []byte {
		b, _ := json.Marshal(map[string]string{"payload": base64.StdEncoding.EncodeToString(p), "signature": base64.StdEncoding.EncodeToString(sig)})
		return b
	}
	signed := envelope(payload, ed25519.Sign(key, payload))
	retry := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/feed", func(w http.ResponseWriter, r *http.Request) { w.Write(signed) })
	mux.HandleFunc("/bad", func(w http.ResponseWriter, r *http.Request) {
		w.Write(envelope(append(payload, ' '), ed25519.Sign(key, payload)))
	})
	mux.HandleFunc("/retry", func(w http.ResponseWriter, r *http.Request) {
		retry++
		if retry < 3 {
			w.WriteHeader(503)
			return
		}
		w.Write(signed)
	})
	mux.HandleFunc("/archive", func(w http.ResponseWriter, r *http.Request) { w.Write(data) })
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Minute):
		}
	})
	listener, e := net.Listen("tcp", "127.0.0.1:46472")
	if e != nil {
		panic(e)
	}
	server := &http.Server{Handler: mux}
	defer server.Close()
	go server.Serve(listener)
	client := updatefeed.Client{Feed: base + "/feed", PublicKey: base64.StdEncoding.EncodeToString(pub)}
	results := []map[string]any{}
	add := func(name string, pass bool) {
		results = append(results, map[string]any{"name": name, "pass": pass})
		fmt.Println(name, pass)
	}
	got, e := client.Check(context.Background())
	add("authenticated HTTP manifest", e == nil && got.Build == "20")
	newer, e := updatefeed.Newer(got, "0.1.2", "19")
	add("same version newer build", e == nil && newer)
	newer, e = updatefeed.Newer(got, "0.1.2", "20")
	add("equal build hidden", e == nil && !newer)
	client.Feed = base + "/bad"
	_, e = client.Check(context.Background())
	add("tampered metadata refused", e != nil)
	client.Feed = base + "/retry"
	_, e = client.Check(context.Background())
	add("transient HTTP retries bounded", e == nil && retry == 3)
	path := filepath.Join(work, "valid")
	var progress int64
	e = updatefeed.Download(context.Background(), &m, path, func(d, t int64) { progress = d })
	add("real transfer and digest", e == nil && progress == m.Size)
	bad := m
	bad.SHA256 = hex.EncodeToString(make([]byte, 32))
	e = updatefeed.Download(context.Background(), &bad, filepath.Join(work, "bad"), func(int64, int64) {})
	_, st := os.Stat(filepath.Join(work, "bad"))
	add("corrupt archive refused and discarded", e != nil && os.IsNotExist(st))
	bad = m
	bad.Size++
	e = updatefeed.Download(context.Background(), &bad, filepath.Join(work, "size"), func(int64, int64) {})
	add("length mismatch refused", e != nil)
	bad = m
	bad.URL = base + "/slow"
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	e = updatefeed.Download(ctx, &bad, filepath.Join(work, "cancel"), func(int64, int64) {})
	cancel()
	add("transfer cancellation", e != nil)
	archive := func(name string, link bool) string {
		var b bytes.Buffer
		gz := gzip.NewWriter(&b)
		tw := tar.NewWriter(gz)
		h := &tar.Header{Name: name, Mode: 0644, Size: 4}
		if link {
			h.Typeflag = tar.TypeSymlink
			h.Linkname = "../../outside"
			h.Size = 0
		}
		tw.WriteHeader(h)
		if !link {
			tw.Write([]byte("test"))
		}
		tw.Close()
		gz.Close()
		p := filepath.Join(work, fmt.Sprintf("archive-%d.gz", len(results)))
		os.WriteFile(p, b.Bytes(), 0600)
		return p
	}
	e = updatefeed.Extract(context.Background(), archive("CyberMe.app/Contents/public.txt", false), filepath.Join(work, "good-extract"))
	add("safe archive extraction", e == nil)
	e = updatefeed.Extract(context.Background(), archive("../outside", false), filepath.Join(work, "bad-extract"))
	add("traversal rejected", e != nil)
	e = updatefeed.Extract(context.Background(), archive("CyberMe.app/escape", true), filepath.Join(work, "link-extract"))
	add("escaping symlink rejected", e != nil)
	result, _ := json.MarshalIndent(map[string]any{"checks": results, "scope": "real loopback HTTP and actual archive extraction; no native installation"}, "", "  ")
	os.WriteFile(filepath.Join(out, "http.json"), result, 0600)
	for _, x := range results {
		if x["pass"] != true {
			os.Exit(1)
		}
	}
}
