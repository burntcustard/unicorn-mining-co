package network

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	frameHeaderSize        = 10
	MaxPayload             = 32 * 1024
	MaxSocketBuffer        = 1024 * 1024
	MaxSnapshotBuffer      = 128 * 1024
	OpContinuation    byte = 0
	OpText            byte = 1
	OpBinary          byte = 2
	OpClose           byte = 8
	OpPing            byte = 9
	OpPong            byte = 10
)

var ErrWebSocket = errors.New("invalid websocket frame")
var ErrSlowClient = errors.New("slow websocket client")
var ErrQueueFull = errors.New("websocket send queue full")
var ErrClosed = errors.New("websocket closed")

type outbound struct {
	opcode byte
	data   []byte
}
type WebSocket struct {
	closing    atomic.Bool
	conn       net.Conn
	reader     *bufio.Reader
	readHeader [14]byte
	queue      chan outbound
	spare      chan []byte
	done       chan struct{}
	once       sync.Once
	buffered   atomic.Int64
	pongMu     sync.Mutex
	lastPong   time.Time
}

func acceptKey(key string) (string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 16 {
		return "", false
	}
	digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(digest[:]), true
}
func headerHas(value, token string) bool {
	for part := range strings.SplitSeq(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), token) {
			return true
		}
	}
	return false
}

// Upgrade accepts the same path and origins as the former Node listener.
func Upgrade(w http.ResponseWriter, r *http.Request, production bool) (*WebSocket, error) {
	origin := r.Header.Get("Origin")
	local := !production && (origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000")
	key, validKey := acceptKey(r.Header.Get("Sec-WebSocket-Key"))
	if r.Method != http.MethodGet || r.URL.RequestURI() != "/game-socket" ||
		!headerHas(r.Header.Get("Connection"), "Upgrade") ||
		!headerHas(r.Header.Get("Upgrade"), "websocket") ||
		r.Header.Get("Sec-WebSocket-Version") != "13" || !validKey ||
		(origin != "" && !local && origin != "https://"+r.Host) {
		http.Error(w, "Bad WebSocket request", http.StatusBadRequest)
		return nil, ErrWebSocket
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "WebSocket unavailable", http.StatusInternalServerError)
		return nil, ErrWebSocket
	}
	conn, buffer, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	if _, err = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + key + "\r\n\r\n"); err != nil {
		conn.Close()
		return nil, err
	}
	if err = buffer.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	socket := &WebSocket{
		conn: conn, reader: buffer.Reader, queue: make(chan outbound, 64), spare: make(chan []byte, 1),
		done: make(chan struct{}), lastPong: time.Now(),
	}
	go socket.writePump()
	return socket, nil
}
func (s *WebSocket) closeTransport()       { s.once.Do(func() { close(s.done); _ = s.conn.Close() }) }
func (s *WebSocket) Done() <-chan struct{} { return s.done }
func (s *WebSocket) BufferedBytes() int {
	return int(s.buffered.Load())
}
func (s *WebSocket) LastPong() time.Time { s.pongMu.Lock(); defer s.pongMu.Unlock(); return s.lastPong }
func (s *WebSocket) markPong()           { s.pongMu.Lock(); s.lastPong = time.Now(); s.pongMu.Unlock() }
func (s *WebSocket) enqueue(opcode byte, payload []byte) error {
	select {
	case <-s.done:
		return ErrClosed
	default:
	}
	if s.buffered.Add(int64(len(payload))) > MaxSocketBuffer {
		s.buffered.Add(-int64(len(payload)))
		s.closeTransport()
		return ErrSlowClient
	}
	var data []byte
	select {
	case data = <-s.spare:
	default:
	}
	length := frameHeaderSize + len(payload)
	if cap(data) < length {
		data = make([]byte, length)
	} else {
		data = data[:length]
	}
	copy(data[frameHeaderSize:], payload)
	select {
	case s.queue <- outbound{opcode: opcode, data: data}:
		return nil
	case <-s.done:
		s.buffered.Add(-int64(len(payload)))
		s.recycle(data)
		return ErrClosed
	default:
		s.buffered.Add(-int64(len(payload)))
		s.recycle(data)
		return ErrQueueFull
	}
}

/*
 * Retain one completed payload buffer for the next send. The queue owns each
 * buffer until its write finishes, so callers can still immediately reuse packets.
 */
func (s *WebSocket) recycle(data []byte) {
	select {
	case s.spare <- data:
	default:
	}
}
func (s *WebSocket) SendBinary(packet []byte) error { return s.enqueue(OpBinary, packet) }
func (s *WebSocket) Ping() error                    { return s.enqueue(OpPing, nil) }
func (s *WebSocket) writePump() {
	for {
		select {
		case <-s.done:
			return
		case frame := <-s.queue:
			err := s.writeFrame(frame.opcode, frame.data)
			s.buffered.Add(-int64(len(frame.data) - frameHeaderSize))
			s.recycle(frame.data)
			if err != nil || frame.opcode == OpClose {
				s.closeTransport()
				return
			}
		}
	}
}

/*
 * Queue buffers reserve space for the largest header. Fill the end of that
 * prefix and send the header and payload together with one ordinary write.
 */
func (s *WebSocket) writeFrame(opcode byte, data []byte) error {
	if err := s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	size := len(data) - frameHeaderSize
	count := 2
	if size >= 126 {
		count = 4
	}
	if size > 65535 {
		count = 10
	}
	header := data[frameHeaderSize-count : frameHeaderSize]
	header[0] = 0x80 | opcode
	switch count {
	case 2:
		header[1] = byte(size)
	case 4:
		header[1] = 126
		binary.BigEndian.PutUint16(header[2:], uint16(size))
	case 10:
		header[1] = 127
		binary.BigEndian.PutUint64(header[2:], uint64(size))
	}
	n, err := s.conn.Write(data[frameHeaderSize-count:])
	if err == nil && n != count+size {
		return io.ErrShortWrite
	}
	return err
}
func (s *WebSocket) CloseWith(code uint16, reason string) {
	if !s.closing.CompareAndSwap(false, true) {
		return
	}
	if len(reason) > 123 {
		reason = reason[:123]
	}
	packet := make([]byte, 2+len(reason))
	binary.BigEndian.PutUint16(packet, code)
	copy(packet[2:], reason)
	if err := s.enqueue(OpClose, packet); err != nil {
		s.closeTransport()
	}
}
func (s *WebSocket) Terminate() { s.closeTransport() }

type inbound struct {
	fin    bool
	opcode byte
	data   []byte
}

func (s *WebSocket) readFrame(buffer []byte) (inbound, error) {
	header := s.readHeader[:2]
	if _, err := io.ReadFull(s.reader, header); err != nil {
		return inbound{}, err
	}
	fin := header[0]&0x80 != 0
	opcode := header[0] & 0x0f
	if header[0]&0x70 != 0 || header[1]&0x80 == 0 {
		return inbound{}, ErrWebSocket
	}
	length := uint64(header[1] & 0x7f)
	if length == 126 {
		extended := s.readHeader[2:4]
		if _, err := io.ReadFull(s.reader, extended); err != nil {
			return inbound{}, err
		}
		length = uint64(binary.BigEndian.Uint16(extended))
		if length < 126 {
			return inbound{}, ErrWebSocket
		}
	} else if length == 127 {
		extended := s.readHeader[2:10]
		if _, err := io.ReadFull(s.reader, extended); err != nil {
			return inbound{}, err
		}
		length = binary.BigEndian.Uint64(extended)
		if length <= 65535 || length>>63 != 0 {
			return inbound{}, ErrWebSocket
		}
	}
	if length > MaxPayload || (opcode >= 8 && (!fin || length > 125)) {
		return inbound{}, ErrWebSocket
	}
	mask := s.readHeader[10:14]
	if _, err := io.ReadFull(s.reader, mask); err != nil {
		return inbound{}, err
	}
	data := buffer
	if cap(data) < int(length) {
		data = make([]byte, int(length))
	} else {
		data = data[:int(length)]
	}
	if _, err := io.ReadFull(s.reader, data); err != nil {
		return inbound{}, err
	}
	for i := range data {
		data[i] ^= mask[i&3]
	}
	return inbound{fin: fin, opcode: opcode, data: data}, nil
}

// ReadMessage handles fragmentation and control frames, returning text frames
// so the session can close them with the existing message-limit policy.
func (s *WebSocket) ReadMessage() (byte, []byte, error) {
	return s.ReadMessageInto(nil)
}

/*
 * Read into caller-owned storage. The returned payload can reuse buffer and
 * remains valid until the caller passes that storage to another read.
 */
func (s *WebSocket) ReadMessageInto(buffer []byte) (byte, []byte, error) {
	var message []byte
	var kind byte
	for {
		frame, err := s.readFrame(buffer)
		if err != nil {
			return 0, nil, err
		}
		switch frame.opcode {
		case OpPing:
			if err := s.enqueue(OpPong, frame.data); err != nil {
				return 0, nil, err
			}
			continue
		case OpPong:
			s.markPong()
			continue
		case OpClose:
			s.closeTransport()
			return OpClose, nil, io.EOF
		case OpText, OpBinary:
			if kind != 0 {
				return 0, nil, ErrWebSocket
			}
			kind = frame.opcode
			if frame.fin {
				// Only fragmented messages need assembly.
				return kind, frame.data, nil
			}
		case OpContinuation:
			if kind == 0 {
				return 0, nil, ErrWebSocket
			}
		default:
			return 0, nil, ErrWebSocket
		}
		if len(message)+len(frame.data) > MaxPayload {
			return 0, nil, ErrWebSocket
		}
		message = append(message, frame.data...)
		if frame.fin {
			return kind, message, nil
		}
	}
}

func (s *WebSocket) IsOpen() bool {
	if s.closing.Load() {
		return false
	}
	select {
	case <-s.done:
		return false
	default:
		return true
	}
}
