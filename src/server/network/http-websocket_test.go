package network

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebSocketUpgradeAndMaskedBinary(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

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

func TestWebSocketOrigins(t *testing.T) {
	for _, production := range []bool{false, true} {
		for _, origin := range []string{"http://localhost:3000", "http://localhost:3002", "http://localhost:3105", "http://127.0.0.1:3003", "http://[::1]:3004", "https://example.com", "http://evil.example:3002", "http://localhost.evil.example:3002", "http://localhost:3002/path", "http://user@localhost:3002", "null"} {
			t.Run(fmt.Sprintf("%t/%s", production, origin), func(t *testing.T) {
				allowed := origin == "https://example.com" || (!production && (origin == "http://localhost:3000" || origin == "http://localhost:3002" || origin == "http://localhost:3105" || origin == "http://127.0.0.1:3003" || origin == "http://[::1]:3004"))

				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					socket, err := Upgrade(w, r, production)

					if err == nil {
						socket.Terminate()
					}
				}))

				defer server.Close()
				conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))

				if err != nil {
					t.Fatal(err)
				}

				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
				_, err = fmt.Fprintf(conn, "GET /game-socket HTTP/1.1\r\nHost: example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: %s\r\n\r\n", origin)

				if err != nil {
					t.Fatal(err)
				}

				response, err := http.ReadResponse(bufio.NewReader(conn), nil)

				if err != nil {
					t.Fatal(err)
				}

				defer response.Body.Close()
				expected := http.StatusBadRequest

				if allowed {
					expected = http.StatusSwitchingProtocols
				}

				if response.StatusCode != expected {
					t.Fatalf("status %d, want %d", response.StatusCode, expected)
				}
			})
		}
	}
}
