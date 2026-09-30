package server

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

func connectGame(t *testing.T, address string) (net.Conn, *bufio.Reader) {
	t.Helper()
	conn, err := net.Dial("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	_, err = fmt.Fprintf(conn, "GET /game-socket HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", address)
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil || !strings.Contains(line, "101") {
		t.Fatalf("upgrade: %s %v", line, err)
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
	return conn, reader
}
func clientFrame(conn net.Conn, kind byte, data []byte) error {
	frame := []byte{0x80 | kind, 0x80 | byte(len(data)), 1, 2, 3, 4}
	for i, b := range data {
		frame = append(frame, b^byte(i%4+1))
	}
	_, err := conn.Write(frame)
	return err
}
func readServerFrame(reader *bufio.Reader) (byte, []byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	length := uint64(header[1])
	if length == 126 {
		var b [2]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(b[:]))
	} else if length == 127 {
		var b [8]byte
		if _, err := io.ReadFull(reader, b[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(b[:])
	}
	data := make([]byte, length)
	_, err := io.ReadFull(reader, data)
	return header[0] & 15, data, err
}
func TestGameServerConcurrentConnections(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	game := NewGameServer(25, catalog)
	listener, err := game.Start(0, t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer game.Stop(context.Background())
	address := listener.Addr().String()
	var wait sync.WaitGroup
	for i := 0; i < 16; i++ {
		wait.Go(func() {
			conn, reader := connectGame(t, address)
			defer conn.Close()
			if err := clientFrame(conn, OpBinary, []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["hello"]), 0}); err != nil {
				t.Error(err)
				return
			}
			for index := 0; index < 2; index++ {
				kind, data, err := readServerFrame(reader)
				if err != nil {
					t.Error(err)
					return
				}
				if kind != OpBinary || len(data) < 4 || data[0] != 0x55 {
					t.Errorf("invalid server frame %x", data)
					return
				}
			}
		})
	}
	wait.Wait()
	for _, test := range []struct {
		name string
		kind byte
		data []byte
		code uint16
	}{
		{"text", OpText, []byte("hello"), 1008}, {"invalid binary", OpBinary, []byte{1, 2, 3}, 1007},
	} {
		t.Run(test.name, func(t *testing.T) {
			conn, reader := connectGame(t, address)
			defer conn.Close()
			if err := clientFrame(conn, test.kind, test.data); err != nil {
				t.Fatal(err)
			}
			kind, data, err := readServerFrame(reader)
			if err != nil {
				t.Fatal(err)
			}
			if kind != OpClose || len(data) < 2 || binary.BigEndian.Uint16(data) != test.code {
				t.Fatalf("close %d %x", kind, data)
			}
		})
	}
}
