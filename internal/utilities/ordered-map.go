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
	entries        []orderedEntry[K, V]
	lookup         map[K]int
}

func NewOrderedMap[K comparable, V any]() *OrderedMap[K, V] {
	return &OrderedMap[K, V]{lookup: make(map[K]int)}
}
func (m *OrderedMap[K, V]) Set(key K, value V) {
	if index := m.lookup[key]; index != 0 {
		m.entries[index-1].value = value
		return
	}
	m.entries = append(m.entries, orderedEntry[K, V]{key: key, value: value, live: true})
	m.lookup[key] = len(m.entries)
}
func (m *OrderedMap[K, V]) Get(key K) (V, bool) {
	if index := m.lookup[key]; index != 0 {
		return m.entries[index-1].value, true
	}
	var zero V
	return zero, false
}
func (m *OrderedMap[K, V]) Has(key K) bool { return m.lookup[key] != 0 }
func (m *OrderedMap[K, V]) Delete(key K) {
	if index := m.lookup[key]; index != 0 {
		m.entries[index-1] = orderedEntry[K, V]{}
		delete(m.lookup, key)
		m.compact()
	}
}
func (m *OrderedMap[K, V]) Len() int { return len(m.lookup) }
func (m *OrderedMap[K, V]) ForEach(f func(V, K)) {
	m.iterationDepth++
	defer func() { m.iterationDepth--; m.compact() }()
	for i := 0; i < len(m.entries); i++ {
		e := &m.entries[i]
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
	count := 0
	for _, entry := range m.entries {
		if entry.live {
			m.entries[count] = entry
			m.lookup[entry.key] = count + 1
			count++
		}
	}
	clear(m.entries[count:])
	m.entries = m.entries[:count]
}

func (m *OrderedMap[K, V]) Clear() {
	clear(m.entries)
	clear(m.lookup)
	if m.iterationDepth == 0 {
		m.entries = m.entries[:0]
	}
}
