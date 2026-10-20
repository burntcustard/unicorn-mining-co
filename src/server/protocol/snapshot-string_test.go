package protocol

import (
	"bytes"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestSnapshotStringsPreserveUTF16WithoutAllocating(t *testing.T) {
	for _, value := range []string{"", "Pirate", "#ff00aa", "\x00\x7f", "Ångström 中文", "🚀𐀀\uffff", strings.Repeat("gold", 100), string([]byte{0xff, 0xc0, 0x80, 0xed, 0xa0, 0x80})} {
		t.Run(value, func(t *testing.T) {
			actual, reference := &writer{}, &writer{}
			actual.string(value)
			units := utf16.Encode([]rune(value))
			reference.unsigned(uint64(len(units)))

			for _, unit := range units {
				reference.byte(byte(unit))
				reference.byte(byte(unit >> 8))
			}

			if !bytes.Equal(actual.data, reference.data) {
				t.Fatal("string encoding differs from UTF-16 reference")
			}

			allocations := testing.AllocsPerRun(100, func() {
				actual.data = actual.data[:0]
				actual.string(value)
			})

			if allocations != 0 {
				t.Fatalf("repeated string encoding allocated %g objects", allocations)
			}
		})
	}
}
