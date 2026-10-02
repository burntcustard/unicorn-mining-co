package server

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHandlerServesHealthAndAssets(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>game</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index-abc123.js"), []byte("const game=1"), 0600); err != nil {
		t.Fatal(err)
	}
	handler := HandleHTTP(dir)
	cases := []struct {
		path, method             string
		status                   int
		body, cache, contentType string
	}{
		{"/healthz", "GET", 200, "ok", "", "text/plain; charset=utf-8"},
		{"/", "GET", 200, "<html>game</html>", "no-cache", "text/html; charset=utf-8"},
		{"/index-abc123.js", "GET", 200, "const game=1", "public, max-age=31536000, immutable", "text/javascript; charset=utf-8"},
		{"/index.html", "HEAD", 200, "", "no-cache", "text/html; charset=utf-8"},
		{"/server.js", "GET", 404, "", "", ""},
		{"/missing", "GET", 404, "", "", ""},
		{"/", "POST", 405, "", "", ""},
	}
	for _, test := range cases {
		request := httptest.NewRequest(test.method, test.path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Errorf("%s %s status %d, want %d", test.method, test.path, response.Code, test.status)
		}
		if response.Body.String() != test.body {
			t.Errorf("%s body %q", test.path, response.Body.String())
		}
		if test.method == "HEAD" && response.Body.Len() != 0 {
			t.Errorf("HEAD returned a body")
		}
		if test.cache != "" && response.Header().Get("Cache-Control") != test.cache {
			t.Errorf("%s cache %q", test.path, response.Header().Get("Cache-Control"))
		}
		if test.contentType != "" && response.Header().Get("Content-Type") != test.contentType {
			t.Errorf("%s content type %q", test.path, response.Header().Get("Content-Type"))
		}
	}
}

func TestWebSocketUpgradeAndMaskedBinary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := Upgrade(w, r, false)
		if err != nil {
			return
		}
		go func() {
			opcode, data, err := socket.ReadMessage()
			if err == nil && opcode == OpBinary {
				_ = socket.SendBinary(data)
			}
		}()
	}))
	defer server.Close()
	address := strings.TrimPrefix(server.URL, "http://")
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	request := fmt.Sprintf("GET /game-socket HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: http://localhost:3000\r\n\r\n", address)
	if _, err := io.WriteString(conn, request); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil || !strings.Contains(line, "101 Switching Protocols") {
		t.Fatalf("upgrade: %q, %v", line, err)
	}
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if line == "\r\n" {
			break
		}
	}
	// Two masked fragments exercise the same message assembly browser sockets use.
	first := []byte{0x02, 0x82, 1, 2, 3, 4, 'h' ^ 1, 'e' ^ 2}
	second := []byte{0x80, 0x83, 1, 2, 3, 4, 'l' ^ 1, 'l' ^ 2, 'o' ^ 3}
	if _, err := conn.Write(first); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write(second); err != nil {
		t.Fatal(err)
	}
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		t.Fatal(err)
	}
	if header[0] != 0x82 || header[1] != 5 {
		t.Fatalf("binary echo header %x", header)
	}
	data := make([]byte, 5)
	if _, err := io.ReadFull(reader, data); err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("binary echo %q", data)
	}
}

func TestProductionOriginRejected(t *testing.T) {
	request := httptest.NewRequest("GET", "http://example.com/game-socket", nil)
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	request.Header.Set("Origin", "http://localhost:3000")
	response := httptest.NewRecorder()
	if socket, err := Upgrade(response, request, true); err == nil || socket != nil {
		t.Fatal("development origin accepted in production")
	}
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d", response.Code)
	}
}
