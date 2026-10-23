// Safe archive extraction adapted from the user-owned Voicemore updater.
package updatefeed

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func Extract(ctx context.Context, archive, dest string) error {
	if err := os.Mkdir(dest, 0700); err != nil {
		return err
	}
	root, err := os.OpenRoot(dest)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	seen := map[string]bool{}
	links := map[string]string{}
	var expanded int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimSuffix(h.Name, "/")
		if name != path.Clean(name) || (name != "CyberMe.app" && !strings.HasPrefix(name, "CyberMe.app/")) || seen[name] {
			return fmt.Errorf("unsafe or duplicate update path: %s", name)
		}
		seen[name] = true
		if err := root.MkdirAll(path.Dir(name), 0755); err != nil {
			return err
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := root.MkdirAll(name, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			expanded += h.Size
			if h.Size < 0 || h.Size > 1<<30 || expanded > 4<<30 {
				return fmt.Errorf("update expansion limit")
			}
			out, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, os.FileMode(h.Mode)&0755)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, tr)
			closeErr := out.Close()
			if err = errors.Join(err, closeErr); err != nil {
				return err
			}
		case tar.TypeSymlink:
			target := path.Clean(path.Join(path.Dir(name), h.Linkname))
			if path.IsAbs(h.Linkname) || !strings.HasPrefix(target, "CyberMe.app/") {
				return fmt.Errorf("unsafe update symlink: %s", name)
			}
			links[name] = h.Linkname
		default:
			return fmt.Errorf("unsupported update entry: %s", name)
		}
	}
	// Create links last; archive content can never be written through a symlink.
	for name, target := range links {
		if err := root.Symlink(target, name); err != nil {
			return err
		}
	}
	// Lexical checks alone do not catch ".." traversing another symlink.
	// Resolve the completed graph and reject dangling/cyclic/external links.
	for name := range links {
		resolved, err := filepath.EvalSymlinks(filepath.Join(dest, name))
		if err != nil {
			return fmt.Errorf("unsafe update symlink: %s: %w", name, err)
		}
		rel, err := filepath.Rel(filepath.Join(dest, "CyberMe.app"), resolved)
		if err != nil || !filepath.IsLocal(rel) {
			return fmt.Errorf("unsafe update symlink: %s", name)
		}
	}

	return nil
}
