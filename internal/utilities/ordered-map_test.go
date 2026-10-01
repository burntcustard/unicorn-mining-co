package utilities

import (
	"slices"
	"testing"
)

func TestOrderedMapMutationDuringIteration(t *testing.T) {
	m := NewOrderedMap[int, int]()
	for i := 1; i <= 3; i++ {
		m.Set(i, i)
	}
	seen := []int{}
	m.ForEach(func(value, key int) {
		seen = append(seen, key)
		if key == 1 {
			m.Set(2, 200)
			m.Delete(3)
			for i := 4; i < 260; i++ {
				m.Set(i, i)
			}
		}
		if key == 2 && value != 200 {
			t.Fatal("iterator did not see updated value")
		}
	})
	want := []int{1, 2}
	for i := 4; i < 260; i++ {
		want = append(want, i)
	}
	if !slices.Equal(seen, want) {
		t.Fatal("delete, update or append changed iteration order")
	}
	for i := 1; i < 200; i++ {
		m.Delete(i)
	}
	for i := 200; i < 260; i++ {
		if v, ok := m.Get(i); !ok || v != i {
			t.Fatalf("compacted key %d missing", i)
		}
	}
	m.Set(1, 10)
	if m.Values()[m.Len()-1] != 10 {
		t.Fatal("reinserted key did not move to end")
	}
}
func TestOrderedMapClearDuringNestedIteration(t *testing.T) {
	m := NewOrderedMap[int, int]()
	m.Set(1, 1)
	m.Set(2, 2)
	seen, nested := []int{}, []int{}
	m.ForEach(func(value, key int) {
		seen = append(seen, key)
		if key == 1 {
			m.Clear()
			m.Set(3, 3)
			m.ForEach(func(value, key int) { nested = append(nested, key) })
		}
	})
	if !slices.Equal(seen, []int{1, 3}) || !slices.Equal(nested, []int{3}) {
		t.Fatal("clear or nested iteration lost insertion order")
	}
	m.Clear()
	m.Set(0, 0)
	if v, ok := m.Get(0); !ok || v != 0 || m.Len() != 1 {
		t.Fatal("clear did not permit reuse")
	}
}
