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
