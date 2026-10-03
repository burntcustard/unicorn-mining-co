package network

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/iotest"
	"time"
)

func maskedFrame(kind byte, final bool, payload []byte) []byte {
	header := byte(kind)
	if final {
		header |= 0x80
	}
	frame := []byte{header, 0x80 | byte(len(payload))}
	if len(payload) >= 126 {
		frame[1] = 0xfe
		frame = binary.BigEndian.AppendUint16(frame, uint16(len(payload)))
	}
	mask := [4]byte{0x31, 0x72, 0xb3, 0xf4}
	frame = append(frame, mask[:]...)
	for i, value := range payload {
		frame = append(frame, value^mask[i&3])
	}
	return frame
}

func TestWebSocketReadMessageBoundaries(t *testing.T) {
	for _, size := range []int{0, 1, 32, 125, 126, 4096, MaxPayload} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			payload := bytes.Repeat([]byte{0x91}, size)
			frames := append(maskedFrame(OpBinary, true, payload), maskedFrame(OpBinary, true, []byte("next"))...)
			socket := &WebSocket{reader: bufio.NewReader(bytes.NewReader(frames))}
			kind, data, err := socket.ReadMessage()
			if err != nil || kind != OpBinary || !bytes.Equal(data, payload) {
				t.Fatalf("first message: %d %x %v", kind, data, err)
			}
			_, next, err := socket.ReadMessage()
			if err != nil || string(next) != "next" || !bytes.Equal(data, payload) {
				t.Fatalf("next message changed retained payload: %q %v", next, err)
			}
		})
	}
}

func TestWebSocketReadMessageInto(t *testing.T) {
	frames := maskedFrame(OpBinary, true, []byte("first"))
	frames = append(frames, maskedFrame(OpBinary, false, []byte("fragment"))...)
	frames = append(frames, maskedFrame(OpPing, true, []byte("ping"))...)
	frames = append(frames, maskedFrame(OpContinuation, true, []byte("end"))...)
	frames = append(frames, maskedFrame(OpBinary, true, bytes.Repeat([]byte{0xa5}, 300))...)
	socket := &WebSocket{reader: bufio.NewReader(bytes.NewReader(frames)), queue: make(chan outbound, 1), done: make(chan struct{})}
	buffer := make([]byte, 0, 64)
	for _, expected := range [][]byte{[]byte("first"), []byte("fragmentend"), bytes.Repeat([]byte{0xa5}, 300)} {
		kind, data, err := socket.ReadMessageInto(buffer)
		if err != nil || kind != OpBinary || !bytes.Equal(data, expected) {
			t.Fatalf("reused receive: %d %x %v", kind, data, err)
		}
		buffer = data
	}
	pong := <-socket.queue
	if pong.opcode != OpPong || string(pong.data[frameHeaderSize:]) != "ping" {
		t.Fatalf("reusing payload changed queued pong: %d %q", pong.opcode, pong.data)
	}
}

func TestWebSocketConcurrentQueueAccounting(t *testing.T) {
	transport, client := net.Pipe()
	defer transport.Close()
	defer client.Close()
	socket := &WebSocket{conn: transport, queue: make(chan outbound, 512), done: make(chan struct{})}
	var wait sync.WaitGroup
	for range 8 {
		wait.Go(func() {
			for range 64 {
				if err := socket.SendBinary(make([]byte, 123)); err != nil {
					t.Error(err)
				}
			}
		})
	}
	wait.Wait()
	if buffered := socket.BufferedBytes(); buffered != 512*123 {
		t.Fatalf("concurrent byte reservations: %d", buffered)
	}
	if err := client.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	go socket.writePump()
	reader := bufio.NewReader(client)
	for range 512 {
		if _, _, err := readServerFrame(reader); err != nil {
			t.Fatal(err)
		}
	}
	// The pump releases each reservation after its write returns.
	deadline := time.Now().Add(time.Second)
	for socket.BufferedBytes() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if buffered := socket.BufferedBytes(); buffered != 0 {
		t.Fatalf("written frames retained %d buffered bytes", buffered)
	}
	socket.Terminate()
}

func TestWebSocketConcurrentPayloadOwnership(t *testing.T) {
	transport, client := net.Pipe()
	defer transport.Close()
	defer client.Close()
	if err := client.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	socket := &WebSocket{conn: transport, queue: make(chan outbound, 64), spare: make(chan []byte, 1), done: make(chan struct{})}
	defer socket.Terminate()
	go socket.writePump()
	var wait sync.WaitGroup
	var acknowledged [8]chan struct{}
	for producer := range acknowledged {
		acknowledged[producer] = make(chan struct{}, 1)
		wait.Go(func() {
			packet := make([]byte, 1024)
			for sequence := range 64 {
				payload := packet[:16+sequence*15]
				for i := range payload {
					payload[i] = byte(producer*64 + sequence)
				}
				payload[0], payload[1] = byte(producer), byte(sequence)
				if err := socket.SendBinary(payload); err != nil {
					t.Error(err)
					return
				}
				clear(packet)
				select {
				case <-acknowledged[producer]:
				case <-socket.Done():
					return
				}
			}
		})
	}
	reader := bufio.NewReader(client)
	var received [8][64]bool
	for range 8 * 64 {
		kind, data, err := readServerFrame(reader)
		if err != nil || kind != OpBinary || len(data) < 16 {
			t.Fatalf("concurrent payload: kind %d, length %d, error %v", kind, len(data), err)
		}
		producer, sequence := int(data[0]), int(data[1])
		if producer >= 8 || sequence >= 64 || received[producer][sequence] || len(data) != 16+sequence*15 {
			t.Fatalf("changed or duplicate payload: %x", data)
		}
		for _, value := range data[2:] {
			if value != byte(producer*64+sequence) {
				t.Fatalf("caller reuse changed queued payload %d/%d", producer, sequence)
			}
		}
		received[producer][sequence] = true
		acknowledged[producer] <- struct{}{}
	}
	wait.Wait()
}

func TestWebSocketFragmentedMessageAndPing(t *testing.T) {
	frames := maskedFrame(OpBinary, false, []byte("first"))
	frames = append(frames, maskedFrame(OpPing, true, []byte("ping"))...)
	frames = append(frames, maskedFrame(OpContinuation, false, nil)...)
	frames = append(frames, maskedFrame(OpContinuation, true, []byte("last"))...)
	transport, client := net.Pipe()
	defer transport.Close()
	defer client.Close()
	if err := client.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	socket := &WebSocket{conn: transport, reader: bufio.NewReader(bytes.NewReader(frames)), queue: make(chan outbound, 1), done: make(chan struct{})}
	kind, data, err := socket.ReadMessage()
	if err != nil || kind != OpBinary || string(data) != "firstlast" {
		t.Fatalf("fragmented message: %d %q %v", kind, data, err)
	}
	// The queued pong must contain the original ping even after later reads.
	go socket.writePump()
	kind, data, err = readServerFrame(bufio.NewReader(client))
	if err != nil || kind != OpPong || string(data) != "ping" {
		t.Fatalf("pong: %d %q %v", kind, data, err)
	}
	socket.Terminate()
}

func TestWebSocketRejectsMalformedFrames(t *testing.T) {
	for _, test := range []struct {
		name string
		data []byte
	}{
		{"unmasked", []byte{0x82, 1, 0}},
		{"reserved", []byte{0xc2, 0x80}},
		{"nonminimal16", []byte{0x82, 0xfe, 0, 125}},
		{"nonminimal64", []byte{0x82, 0xff, 0, 0, 0, 0, 0, 0, 0xff, 0xff}},
		{"oversize", []byte{0x82, 0xfe, 0x80, 1}},
		{"fragmented control", maskedFrame(OpPing, false, nil)},
		{"large control", maskedFrame(OpPing, true, make([]byte, 126))},
		{"unexpected continuation", maskedFrame(OpContinuation, true, nil)},
		{"fragment interrupted", append(maskedFrame(OpBinary, false, nil), maskedFrame(OpBinary, true, nil)...)},
		{"fragment total", append(maskedFrame(OpBinary, false, make([]byte, MaxPayload)), maskedFrame(OpContinuation, true, []byte{1})...)},
	} {
		t.Run(test.name, func(t *testing.T) {
			socket := &WebSocket{reader: bufio.NewReader(bytes.NewReader(test.data))}
			if _, _, err := socket.ReadMessage(); !errors.Is(err, ErrWebSocket) {
				t.Fatalf("error %v, expected malformed-frame rejection", err)
			}
		})
	}
}

func TestWebSocketPartialReads(t *testing.T) {
	payload := bytes.Repeat([]byte{0x12, 0x34, 0x56}, 100)
	frame := maskedFrame(OpBinary, true, payload)
	socket := &WebSocket{reader: bufio.NewReader(iotest.OneByteReader(bytes.NewReader(frame)))}
	kind, data, err := socket.ReadMessage()
	if err != nil || kind != OpBinary || !bytes.Equal(data, payload) {
		t.Fatalf("partial reads: %d %x %v", kind, data, err)
	}
}

type shortWriteConn struct{ net.Conn }

func (c shortWriteConn) Write(data []byte) (int, error) { return len(data) - 1, nil }

func TestWebSocketShortWrite(t *testing.T) {
	transport, client := net.Pipe()
	defer transport.Close()
	defer client.Close()
	socket := &WebSocket{conn: shortWriteConn{transport}}
	for _, size := range []int{5, 8192} {
		if err := socket.writeFrame(OpBinary, make([]byte, frameHeaderSize+size)); !errors.Is(err, io.ErrShortWrite) {
			t.Fatalf("short write of %d bytes: %v", size, err)
		}
	}
}

func TestWebSocketOutgoingPayloadOwnership(t *testing.T) {
	for _, size := range []int{0, 125, 126, 4096, 4097, 65535, 65536} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			joined := make(chan *WebSocket, 1)
			httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				socket, err := Upgrade(w, r, false)
				if err == nil {
					joined <- socket
				}
			}))
			defer httpServer.Close()
			conn, reader := connectGame(t, strings.TrimPrefix(httpServer.URL, "http://"))
			defer conn.Close()
			socket := <-joined
			defer socket.Terminate()
			payload := bytes.Repeat([]byte{0xa5}, size)
			if err := socket.SendBinary(payload); err != nil {
				t.Fatal(err)
			}
			clear(payload)
			kind, data, err := readServerFrame(reader)
			if err != nil || kind != OpBinary || len(data) != size || !bytes.Equal(data, bytes.Repeat([]byte{0xa5}, size)) {
				t.Fatalf("send changed payload: %d bytes, kind %d, error %v", len(data), kind, err)
			}
		})
	}
}

func TestWebSocketQueueAccounting(t *testing.T) {
	transport, client := net.Pipe()
	defer transport.Close()
	defer client.Close()
	socket := &WebSocket{conn: transport, queue: make(chan outbound, 1), done: make(chan struct{})}
	if err := socket.SendBinary([]byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := socket.SendBinary([]byte("second")); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("full queue: %v", err)
	}
	if buffered := socket.BufferedBytes(); buffered != 5 {
		t.Fatalf("buffered payload %d, expected 5", buffered)
	}
	if err := socket.SendBinary(make([]byte, MaxSocketBuffer)); !errors.Is(err, ErrSlowClient) {
		t.Fatalf("byte limit: %v", err)
	}
	if socket.IsOpen() {
		t.Fatal("slow client stayed open")
	}
	if err := socket.SendBinary(nil); !errors.Is(err, ErrClosed) {
		t.Fatalf("closed socket: %v", err)
	}
}

func BenchmarkWebSocketReadMessage(b *testing.B) {
	for _, size := range []int{32, 1024, MaxPayload} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			frame := maskedFrame(OpBinary, true, make([]byte, size))
			input := bytes.NewReader(frame)
			socket := &WebSocket{reader: bufio.NewReader(input)}
			b.ReportAllocs()
			b.SetBytes(int64(size))
			for b.Loop() {
				input.Reset(frame)
				kind, data, err := socket.ReadMessage()
				if err != nil || kind != OpBinary || len(data) != size {
					b.Fatal(kind, len(data), err)
				}
			}
		})
	}
}

func BenchmarkWebSocketReadMessageInto(b *testing.B) {
	for _, size := range []int{32, 1024, MaxPayload} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			frame := maskedFrame(OpBinary, true, make([]byte, size))
			input := bytes.NewReader(frame)
			socket := &WebSocket{reader: bufio.NewReader(input)}
			buffer := make([]byte, size)
			b.ReportAllocs()
			b.SetBytes(int64(size))
			for b.Loop() {
				input.Reset(frame)
				kind, data, err := socket.ReadMessageInto(buffer)
				if err != nil || kind != OpBinary || len(data) != size {
					b.Fatal(kind, len(data), err)
				}
				buffer = data
			}
		})
	}
}
