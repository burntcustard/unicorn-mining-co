package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"io"
	"math"
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
func TestGameServerReadHeaderTimeout(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	game := NewGameServer(25, catalog)
	listener, err := game.Start(0, t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	defer game.Stop(context.Background())
	if game.http.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("header timeout: %s", game.http.ReadHeaderTimeout)
	}
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(7 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(conn, "GET /game-socket HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nX-Slow: "); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadAll(conn); err != nil {
		t.Fatalf("incomplete headers were not closed by the server: %v", err)
	}
	if clients := game.clients.Load(); clients != 0 {
		t.Fatalf("incomplete headers reached the WebSocket handler: %d clients", clients)
	}
}

func TestGameServerJoinBetweenTicks(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	// A deliberately long tick period makes waiting for a tick observable.
	catalog.Simulation.SimulationStep = 1
	game := NewGameServer(25, catalog)
	listener, err := game.Start(0, t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer game.Stop(context.Background())
	conn, reader := connectGame(t, listener.Addr().String())
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if err := clientFrame(conn, OpBinary, []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["hello"]), 0}); err != nil {
		t.Fatal(err)
	}
	for _, marker := range []byte{0x43, 0x4d} {
		kind, data, err := readServerFrame(reader)
		if err != nil || kind != OpBinary || len(data) < 4 || data[1] != marker {
			t.Fatalf("join waited for a simulation tick: kind %d, data %x, error %v", kind, data, err)
		}
	}
}

func TestGameServerInputEdgesBetweenTicks(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	catalog.Simulation.SimulationStep = .25
	game := NewGameServer(25, catalog)
	listener, err := game.Start(0, t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer game.Stop(context.Background())
	conn, reader := connectGame(t, listener.Addr().String())
	defer conn.Close()
	if err := clientFrame(conn, OpBinary, []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["hello"]), 0}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, _, err := readServerFrame(reader); err != nil {
			t.Fatal(err)
		}
	}
	var frames []byte
	for _, change := range []struct {
		sequence byte
		code     byte
		offset   float64
	}{{1, 128, 0}, {2, 64, .125}, {2, 128, .2}} {
		packet := []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["input"]), 0, change.sequence, change.code, 1}
		packet = binary.LittleEndian.AppendUint64(packet, math.Float64bits(change.offset))
		frames = append(frames, maskedFrame(OpBinary, true, packet)...)
	}
	if _, err := conn.Write(frames); err != nil {
		t.Fatal(err)
	}
	_, data, err := readServerFrame(reader)
	if err != nil || len(data) < 4 || data[1] != 0x4d || data[3]&4 == 0 {
		t.Fatalf("snapshot after input edges: %x %v", data, err)
	}
	header := bytes.NewReader(data[4:])
	for range 2 {
		if _, err := binary.ReadUvarint(header); err != nil {
			t.Fatal(err)
		}
	}
	acknowledged, err := binary.ReadUvarint(header)
	if err != nil || acknowledged != 2 {
		t.Fatalf("queued input acknowledgement: %d %v", acknowledged, err)
	}
	if err := game.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	// The stopped owner makes inspection safe; both edges must survive the inbox.
	game.session.players.ForEach(func(player *playerRecord, _ string) {
		changes := player.frame.Changes
		if len(changes) != 2 || changes[0].Input.Turn != 1 || changes[1].Input.Turn != -1 || changes[1].Offset != .125 {
			t.Fatalf("ordered input edges changed: %+v", changes)
		}
	})
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
	for range 16 {
		wait.Go(func() {
			conn, reader := connectGame(t, address)
			defer conn.Close()
			if err := clientFrame(conn, OpBinary, []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["hello"]), 0}); err != nil {
				t.Error(err)
				return
			}
			for range 2 {
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
