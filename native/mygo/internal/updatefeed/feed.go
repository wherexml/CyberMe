// Authenticated update metadata and cancellable downloads. No installation here.
package updatefeed

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Manifest struct {
	Version   string `json:"version"`
	Build     string `json:"build"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
	DataEpoch string `json:"dataEpoch"`
}
type Client struct {
	Feed      string `json:"feed"`
	PublicKey string `json:"publicKey"`
}

func validURL(raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil {
		return errors.New("invalid_update_url")
	}
	if u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil
	}
	return errors.New("https_required")
}
func get(ctx context.Context, raw string) (*http.Response, error) {
	if e := validURL(raw); e != nil {
		return nil, e
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 20 * time.Second
	client := http.Client{Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("too_many_redirects")
		}
		if via[len(via)-1].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return errors.New("https_required")
		}
		return validURL(req.URL.String())
	}}
	for attempt := 0; attempt < 3; attempt++ {
		req, e := http.NewRequestWithContext(ctx, "GET", raw, nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("User-Agent", "CyberMe-Updater")
		r, e := client.Do(req)
		retry := false
		if e != nil {
			var n net.Error
			retry = errors.As(e, &n) && n.Timeout()
		} else if r.StatusCode == 200 {
			return r, nil
		} else {
			r.Body.Close()
			retry = r.StatusCode == 408 || r.StatusCode == 429 || r.StatusCode == 502 || r.StatusCode == 503 || r.StatusCode == 504
			e = fmt.Errorf("update_http_%d", r.StatusCode)
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if !retry || attempt == 2 {
			return nil, e
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(attempt+1) * time.Second):
		}
	}
	return nil, errors.New("update_network_failed")
}
func Parse(body []byte, key string) (*Manifest, error) {
	var envelope struct {
		Payload   string `json:"payload"`
		Signature string `json:"signature"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return nil, errors.New("invalid_manifest")
	}
	payload, e := base64.StdEncoding.DecodeString(envelope.Payload)
	if e != nil {
		return nil, errors.New("invalid_manifest")
	}
	sig, e := base64.StdEncoding.DecodeString(envelope.Signature)
	pub, e2 := base64.StdEncoding.DecodeString(key)
	if e != nil || e2 != nil || len(pub) != ed25519.PublicKeySize || !ed25519.Verify(pub, payload, sig) {
		return nil, errors.New("manifest_signature_rejected")
	}
	var m Manifest
	if json.Unmarshal(payload, &m) != nil || m.Size <= 0 || m.Size > 2<<30 {
		return nil, errors.New("invalid_manifest")
	}
	if _, e := version(m.Version); e != nil {
		return nil, e
	}
	if _, e := strconv.ParseUint(m.Build, 10, 64); e != nil {
		return nil, errors.New("invalid_build")
	}
	hash, e := hex.DecodeString(m.SHA256)
	if e != nil || len(hash) != 32 || m.DataEpoch == "" {
		return nil, errors.New("invalid_manifest")
	}
	if e = validURL(m.URL); e != nil {
		return nil, e
	}
	return &m, nil
}
func (c Client) Check(ctx context.Context) (*Manifest, error) {
	r, e := get(ctx, c.Feed)
	if e != nil {
		return nil, e
	}
	defer r.Body.Close()
	b, e := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
	if e != nil {
		return nil, e
	}
	if len(b) > 1<<20 {
		return nil, errors.New("manifest_too_large")
	}
	return Parse(b, c.PublicKey)
}
func version(s string) ([3]uint64, error) {
	var v [3]uint64
	p := strings.Split(s, ".")
	if len(p) != 3 {
		return v, errors.New("invalid_version")
	}
	for i, x := range p {
		n, e := strconv.ParseUint(x, 10, 32)
		if e != nil || x == "" {
			return v, errors.New("invalid_version")
		}
		v[i] = n
	}
	return v, nil
}
func Newer(m *Manifest, currentVersion, currentBuild string) (bool, error) {
	a, e := version(m.Version)
	if e != nil {
		return false, e
	}
	b, e := version(currentVersion)
	if e != nil {
		return false, e
	}
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i], nil
		}
	}
	x, e := strconv.ParseUint(m.Build, 10, 64)
	if e != nil {
		return false, e
	}
	y, e := strconv.ParseUint(currentBuild, 10, 64)
	return x > y, e
}
func Download(ctx context.Context, m *Manifest, file string, progress func(int64, int64)) error {
	r, e := get(ctx, m.URL)
	if e != nil {
		return e
	}
	defer r.Body.Close()
	f, e := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(file)
		}
	}()
	h := sha256.New()
	buf := make([]byte, 128*1024)
	var total int64
	for {
		if e = ctx.Err(); e != nil {
			return e
		}
		n, err := r.Body.Read(buf)
		if n > 0 {
			total += int64(n)
			if total > m.Size {
				return errors.New("archive_size_mismatch")
			}
			if _, e = f.Write(buf[:n]); e != nil {
				return e
			}
			h.Write(buf[:n])
			progress(total, m.Size)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if total != m.Size {
		return errors.New("archive_size_mismatch")
	}
	if hex.EncodeToString(h.Sum(nil)) != m.SHA256 {
		return errors.New("archive_digest_rejected")
	}
	if e = f.Close(); e != nil {
		return e
	}
	ok = true
	return nil
}

// Never include signed URL query strings or private path details in the UI.
func Code(err error) string {
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "update_timeout"
	}
	s := err.Error()
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_') {
			return "update_failed"
		}
	}
	return s
}
