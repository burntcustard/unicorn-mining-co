package persistence

import (
	"bytes"
	"encoding/gob"
	"fmt"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
)

// entityEncoder retains Gob's concrete type descriptors and encoder state while
// keeping every returned record independently decodable by the existing reader.
// The persistence writer owns the encoder; it is not shared across goroutines.
type entityEncoder struct {
	buffer  bytes.Buffer
	encoder *gob.Encoder
	prefix  []byte
}

func newEntityEncoder() (*entityEncoder, error) {
	e := &entityEncoder{}
	e.encoder = gob.NewEncoder(&e.buffer)

	if err := e.encoder.Encode(objects.SavedEntity{}); err != nil {
		return nil, err
	}

	first := bytes.Clone(e.buffer.Bytes())
	e.buffer.Reset()

	if err := e.encoder.Encode(objects.SavedEntity{}); err != nil {
		return nil, err
	}

	// Gob sends the complete concrete field graph before the first value.
	// Encoding that value again yields only its payload, letting us retain the
	// descriptors without interpreting Gob's framing or relying on write calls.
	payload := e.buffer.Bytes()

	if len(payload) == 0 || len(first) <= len(payload) || !bytes.HasSuffix(first, payload) {
		return nil, fmt.Errorf("could not isolate saved entity Gob descriptors")
	}

	e.prefix = first[:len(first)-len(payload)]
	e.buffer.Reset()
	return e, nil
}

func (e *entityEncoder) Encode(state objects.SavedEntity) ([]byte, error) {
	e.buffer.Reset()

	if err := e.encoder.Encode(state); err != nil {
		return nil, err
	}

	data := make([]byte, len(e.prefix)+e.buffer.Len())
	copy(data, e.prefix)
	copy(data[len(e.prefix):], e.buffer.Bytes())
	return data, nil
}
