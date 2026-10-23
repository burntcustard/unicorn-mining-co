package network

import (
	"encoding/hex"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
)

type benchmarkSocket struct {
	packets, bytes int
	sequence       uint64
	acknowledged   uint64
	inputSequence  uint64
	trace          []string
	record         bool
}

func (s *benchmarkSocket) IsOpen() bool { return true }

func (s *benchmarkSocket) BufferedBytes() int { return 0 }

func (s *benchmarkSocket) SendBinary(data []byte) error {
	s.packets++
	s.bytes += len(data)

	if data[1] == 0x4d {
		offset := 4

		read := func() uint64 {
			var value uint64
			shift := 0

			for {
				part := data[offset]
				offset++
				value |= uint64(part&127) << shift

				if part&128 == 0 {
					return value
				}

				shift += 7
			}
		}

		read()
		read()

		if data[3]&4 != 0 {
			s.inputSequence = read()
		}

		if data[3]&8 != 0 {
			read()
		}

		if data[3]&16 != 0 {
			s.sequence = read()
		}
	}

	if s.record {
		s.trace = append(s.trace, hex.EncodeToString(data))
	}

	return nil
}

// Match the production client: only requested receipts produce controls.
func (s *benchmarkSocket) acknowledge(session *GameSession) {
	if s.sequence != s.acknowledged {
		s.acknowledged = s.sequence
		session.Receive(protocol.Control{Type: "snapshotAck", Sequence: s.sequence}, s)
	}
}

func (s *benchmarkSocket) Terminate() {}

func (s *benchmarkSocket) CloseWith(uint16, string) {}
