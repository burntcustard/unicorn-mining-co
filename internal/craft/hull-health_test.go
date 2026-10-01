package craft

import "testing"

func TestEmptyHullHealthRemainsAnArray(t *testing.T) {
	craft := &Craft{}
	for _, values := range [][]float64{nil, make([]float64, 0, 4)} {
		got := craft.AppendHullHealth(values)
		if got == nil || len(got) != 0 {
			t.Fatal("empty hull health must encode as an empty array")
		}
	}
}
