// Port of src/server/http-handler.ts using Go's HTTP and filesystem APIs.
package network

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var contentTypes = map[string]string{
	".css":  "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
	".txt":  "text/plain; charset=utf-8",
}
var hashedAsset = regexp.MustCompile(`-[\w-]+\.(?:js|css)$`)

// URL normalizes literal and percent-encoded dot segments before
// decodeURIComponent decodes the pathname in the TypeScript handler.
func requestPath(raw string) (string, error) {
	if raw == "" {
		raw = "/"
	}
	raw = strings.ReplaceAll(raw, "\\", "/")
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	escaped := parsed.EscapedPath()
	if escaped == "" {
		escaped = "/"
	}
	parts := strings.Split(escaped, "/")
	normalized := make([]string, 0, len(parts))
	for i, part := range parts {
		dot := strings.ReplaceAll(strings.ToLower(part), "%2e", ".")
		switch dot {
		case ".":
			if i == len(parts)-1 {
				normalized = append(normalized, "")
			}
		case "..":
			if len(normalized) > 1 {
				normalized = normalized[:len(normalized)-1]
			}
			if i == len(parts)-1 {
				normalized = append(normalized, "")
			}
		default:
			normalized = append(normalized, part)
		}
	}
	pathname, err := url.PathUnescape(strings.Join(normalized, "/"))
	if err != nil {
		return "", err
	}
	if !utf8.ValidString(pathname) {
		return "", url.InvalidHostError("invalid UTF-8 pathname")
	}
	return pathname, nil
}

// HandleHTTP handles only ordinary HTTP requests. GameServer owns upgrades,
// just as the separate upgrade listener in the TypeScript implementation does.
func HandleHTTP(assets string) http.Handler {
	root, err := filepath.Abs(assets)
	if err != nil {
		panic(err)
	}
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		raw := request.RequestURI
		if raw == "" {
			raw = request.URL.RequestURI()
		}
		if raw == "/healthz" {
			response.Header().Set("Content-Type", "text/plain; charset=utf-8")
			response.WriteHeader(http.StatusOK)
			if request.Method != http.MethodHead {
				_, _ = io.WriteString(response, "ok")
			}
			return
		}
		if request.Host == "www.unicorn-mining.co" {
			if raw == "" {
				raw = "/"
			}
			response.Header().Set("Location", "https://unicorn-mining.co"+raw)
			response.WriteHeader(http.StatusPermanentRedirect)
			return
		}
		if request.Method != http.MethodGet && request.Method != http.MethodHead {
			response.Header().Set("Allow", "GET, HEAD")
			response.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		pathname, err := requestPath(raw)
		if err != nil {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		if pathname == "/server.js" {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		if pathname == "/" {
			pathname = "/index.html"
		}
		file := filepath.Clean(root + string(filepath.Separator) + "." + pathname)
		if !strings.HasPrefix(file, root+string(filepath.Separator)) {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		details, err := os.Stat(file)
		if err != nil || !details.Mode().IsRegular() {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		opened, err := os.Open(file)
		if err != nil {
			response.WriteHeader(http.StatusNotFound)
			return
		}
		defer opened.Close()
		cache := "public, max-age=3600"
		if strings.HasSuffix(file, "index.html") {
			cache = "no-cache"
		} else if hashedAsset.MatchString(file) {
			cache = "public, max-age=31536000, immutable"
		}
		response.Header().Set("Cache-Control", cache)
		response.Header().Set("Content-Length", strconv.FormatInt(details.Size(), 10))
		contentType := contentTypes[filepath.Ext(file)]
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		response.Header().Set("Content-Type", contentType)
		response.WriteHeader(http.StatusOK)
		if request.Method != http.MethodHead {
			_, _ = io.Copy(response, opened)
		}
	})
}
