package network

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestHTTPHandler(t *testing.T) {
	root := t.TempDir()

	files := map[string]string{
		"index.html":           "<html>game</html>",
		"assets/app-abc123.js": "const game=1;",
		"assets/site-123.css":  "body{}",
		"nested/index.html":    "nested",
		"data.json":            "{}",
		"image.svg":            "<svg/>",
		"plain.txt":            "text",
		"data.bin":             "binary",
		"space name.txt":       "space",
	}

	for name, contents := range files {
		path := filepath.Join(root, name)

		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		path, method, host      string
		status                  int
		headers, requestHeaders map[string]string
		body                    string
	}{
		{path: "/healthz", status: 200, headers: map[string]string{"Content-Type": "text/plain; charset=utf-8"}, body: "ok"},
		{path: "/healthz?check=1", status: 404},
		{path: "/", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}, body: "<html>game</html>"},
		{path: "/index.html?x=1", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}, body: "<html>game</html>"},
		{path: "/assets/app-abc123.js", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=31536000, immutable", "Content-Length": "13", "Content-Type": "text/javascript; charset=utf-8"}, body: "const game=1;"},
		{path: "/assets/site-123.css", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=31536000, immutable", "Content-Length": "6", "Content-Type": "text/css; charset=utf-8"}, body: "body{}"},
		{path: "/nested/index.html", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "6", "Content-Type": "text/html; charset=utf-8"}, body: "nested"},
		{path: "/data.json", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=3600", "Content-Length": "2", "Content-Type": "application/json; charset=utf-8"}, body: "{}"},
		{path: "/image.svg", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=3600", "Content-Length": "6", "Content-Type": "image/svg+xml"}, body: "<svg/>"},
		{path: "/plain.txt", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=3600", "Content-Length": "4", "Content-Type": "text/plain; charset=utf-8"}, body: "text"},
		{path: "/data.bin", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=3600", "Content-Length": "6", "Content-Type": "application/octet-stream"}, body: "binary"},
		{path: "/space%20name.txt", status: 200, headers: map[string]string{"Cache-Control": "public, max-age=3600", "Content-Length": "5", "Content-Type": "text/plain; charset=utf-8"}, body: "space"},
		{path: "/server.js", status: 404},
		{path: "/%73erver.js", status: 404},
		{path: "/assets", status: 404},
		{path: "/missing", status: 404},
		{path: "/assets/../index.html", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}, body: "<html>game</html>"},
		{path: "/assets/%2e%2e/index.html", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}, body: "<html>game</html>"},
		{path: "/%2e%2e%2fpackage.json", status: 404},
		{path: "/%ff", status: 400},
		{path: "/bad%escape", status: 400},
		{path: "/index.html", status: 200, method: "HEAD", headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}},
		{path: "/", status: 405, method: "POST", headers: map[string]string{"Allow": "GET, HEAD"}},
		{path: "/healthz", status: 200, method: "POST", host: "www.unicorn-mining.co", headers: map[string]string{"Content-Type": "text/plain; charset=utf-8"}, body: "ok"},
		{path: "/a?b=1", status: 308, method: "POST", host: "www.unicorn-mining.co", headers: map[string]string{"Location": "https://unicorn-mining.co/a?b=1"}},
		{path: "/index.html", status: 200, headers: map[string]string{"Cache-Control": "no-cache", "Content-Length": "17", "Content-Type": "text/html; charset=utf-8"}, body: "<html>game</html>", requestHeaders: map[string]string{"range": "bytes=0-2", "if-modified-since": "Wed, 01 Jan 2100 00:00:00 GMT"}},
	}

	handler := HandleHTTP(root)

	for _, test := range cases {
		method := test.method

		if method == "" {
			method = "GET"
		}

		t.Run(method+test.path, func(t *testing.T) {
			// Preserve malformed paths to exercise the handler's validation.
			request := httptest.NewRequest(method, "/", nil)
			request.RequestURI = test.path

			if parsed, err := url.Parse(test.path); err == nil {
				request.URL = parsed
			}

			request.Host = test.host

			for key, value := range test.requestHeaders {
				request.Header.Set(key, value)
			}

			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != test.status || response.Body.String() != test.body {
				t.Fatalf("got %d %q, want %d %q", response.Code, response.Body.String(), test.status, test.body)
			}

			headers := map[string]string{}

			for key := range response.Header() {
				headers[key] = response.Header().Get(key)
			}

			want := test.headers

			if want == nil {
				want = map[string]string{}
			}

			if !reflect.DeepEqual(headers, want) {
				t.Fatalf("got headers %v, want %v", headers, want)
			}
		})
	}
}
