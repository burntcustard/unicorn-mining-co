package utilities

// OrderedMap preserves JavaScript Map iteration, including deletion and
// reinsertion during iteration. Go's built-in map is used only for lookup.
type orderedEntry[K comparable, V any] struct {
	key   K
	value V
	live  bool
}
type OrderedMap[K comparable, V any] struct {
	iterationDepth int
	entries        []*orderedEntry[K, V]
	lookup         map[K]*orderedEntry[K, V]
}

func NewOrderedMap[K comparable, V any]() *OrderedMap[K, V] {
	return &OrderedMap[K, V]{lookup: make(map[K]*orderedEntry[K, V])}
}
func (m *OrderedMap[K, V]) Set(key K, value V) {
	if e := m.lookup[key]; e != nil {
		e.value = value
		return
	}
	e := &orderedEntry[K, V]{key: key, value: value, live: true}
	m.lookup[key] = e
	m.entries = append(m.entries, e)
}
func (m *OrderedMap[K, V]) Get(key K) (V, bool) {
	if e := m.lookup[key]; e != nil {
		return e.value, true
	}
	var zero V
	return zero, false
}
func (m *OrderedMap[K, V]) Has(key K) bool { return m.lookup[key] != nil }
func (m *OrderedMap[K, V]) Delete(key K) {
	if e := m.lookup[key]; e != nil {
		e.live = false
		var zero V
		e.value = zero
		delete(m.lookup, key)
		m.compact()
	}
}
func (m *OrderedMap[K, V]) Len() int { return len(m.lookup) }
func (m *OrderedMap[K, V]) ForEach(f func(V, K)) {
	m.iterationDepth++
	defer func() { m.iterationDepth--; m.compact() }()
	for i := 0; i < len(m.entries); i++ {
		e := m.entries[i]
		if e.live {
			f(e.value, e.key)
		}
	}
}
func (m *OrderedMap[K, V]) Values() []V {
	values := make([]V, 0, m.Len())
	m.ForEach(func(v V, _ K) { values = append(values, v) })
	return values
}

// Reclaim tombstones only when no iterator can still reference their positions.
func (m *OrderedMap[K, V]) compact() {
	if m.iterationDepth > 0 || len(m.entries) <= 2*m.Len()+128 {
		return
	}
	entries := make([]*orderedEntry[K, V], 0, m.Len())
	for _, e := range m.entries {
		if e.live {
			entries = append(entries, e)
		}
	}
	m.entries = entries
}

func (m *OrderedMap[K, V]) Clear() {
	for _, e := range m.entries {
		e.live = false
		var zero V
		e.value = zero
	}
	clear(m.lookup)
	if m.iterationDepth == 0 {
		m.entries = nil
	}
}
