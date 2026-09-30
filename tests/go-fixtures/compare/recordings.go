package compare

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
)

func JSON(t *testing.T, path string, actual any, want json.RawMessage, tolerance float64) {
	t.Helper()
	encoded, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err = json.Unmarshal(encoded, &a); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(want, &b); err != nil {
		t.Fatal(err)
	}
	var compare func(string, any, any)
	compare = func(path string, a, b any) {
		switch b := b.(type) {
		case float64:
			n, ok := a.(float64)
			if !ok || math.Abs(n-b) > tolerance {
				t.Fatalf("%s: got %.17v, want %.17v", path, a, b)
			}
		case []any:
			v, ok := a.([]any)
			if !ok || len(v) != len(b) {
				t.Fatalf("%s: array lengths differ: got %v, want %v", path, a, b)
			}
			for i, x := range b {
				compare(fmt.Sprintf("%s[%d]", path, i), v[i], x)
			}
		case map[string]any:
			v, ok := a.(map[string]any)
			if !ok || len(v) != len(b) {
				t.Fatalf("%s: object keys differ: got %v, want %v", path, a, b)
			}
			for k, x := range b {
				compare(path+"."+k, v[k], x)
			}
		default:
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("%s: got %v, want %v", path, a, b)
			}
		}
	}
	compare(path, a, b)
}
