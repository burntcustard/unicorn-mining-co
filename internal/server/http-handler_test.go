package server

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTypeScriptHTTP(t *testing.T) {
	data, err := os.ReadFile("../../tests/go-fixtures/http.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Files   map[string]string
		Samples []struct {
			Request struct {
				URL, Method string
				Headers     map[string]string
			}
			Status  int
			Headers map[string]any
			Body    string
		}
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	for name, contents := range fixture.Files {
		path := filepath.Join(root, name)
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	handler := HandleHTTP(root)
	for _, sample := range fixture.Samples {
		t.Run(sample.Request.Method+sample.Request.URL, func(t *testing.T) {
			// Keep malformed URL input intact: Node's decodeURIComponent rejects it
			// inside the handler, while net/http normally rejects it before dispatch.
			request := httptest.NewRequest(sample.Request.Method, "/", nil)
			request.RequestURI = sample.Request.URL
			if parsed, err := url.Parse(sample.Request.URL); err == nil {
				request.URL = parsed
			}
			request.Host = sample.Request.Headers["host"]
			for key, value := range sample.Request.Headers {
				request.Header.Set(key, value)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != sample.Status || response.Body.String() != sample.Body {
				t.Fatalf("got %d %q, want %d %q", response.Code, response.Body.String(), sample.Status, sample.Body)
			}
			for key, value := range sample.Headers {
				if got, want := response.Header().Get(key), fmt.Sprint(value); got != want {
					t.Fatalf("%s: got %q, want %q", key, got, want)
				}
			}
			for key := range response.Header() {
				found := false
				for expected := range sample.Headers {
					if strings.EqualFold(expected, key) {
						found = true
					}
				}
				if !found {
					t.Errorf("unexpected header %s", key)
				}
			}
		})
	}
}
