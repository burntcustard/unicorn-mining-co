use std::hash::Hash;
use std::sync::Arc;

use hashbrown::HashMap;

/// JavaScript Map iteration order, including reinsertion during iteration.
pub struct OrderedMap<K, V> {
    entries: Vec<Option<(K, V)>>,
    lookup: HashMap<K, usize>,
    read_values: Option<Arc<[V]>>,
    iteration_depth: usize,
}

impl<K, V> Default for OrderedMap<K, V> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            lookup: HashMap::new(),
            read_values: None,
            iteration_depth: 0,
        }
    }
}

impl<K: Eq + Hash + Clone, V> OrderedMap<K, V> {
    pub fn set(&mut self, key: K, value: V) {
        self.read_values = None;
        let index = *self.lookup.entry(key.clone()).or_insert(self.entries.len());
        if index == self.entries.len() {
            self.entries.push(Some((key, value)));
        } else {
            self.entries[index] = Some((key, value));
        }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.get_indexed(key).map(|(_, value)| value)
    }

    pub(crate) fn get_indexed(&self, key: &K) -> Option<(usize, &V)> {
        let index = self.slot(key)?;
        let entry = self.entries[index].as_ref()?;
        Some((index, &entry.1))
    }

    pub(crate) fn slot(&self, key: &K) -> Option<usize> {
        self.lookup.get(key).copied()
    }

    pub(crate) fn get_at(&self, index: usize, key: &K) -> Option<&V> {
        let (entry_key, value) = self.entries.get(index)?.as_ref()?;
        (entry_key == key).then_some(value)
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        let index = *self.lookup.get(key)?;
        self.read_values = None;
        self.entries[index].as_mut().map(|entry| &mut entry.1)
    }

    pub(crate) fn get_at_mut(&mut self, index: usize, key: &K) -> Option<&mut V> {
        let (entry_key, value) = self.entries.get_mut(index)?.as_mut()?;
        if entry_key != key {
            return None;
        }
        self.read_values = None;
        Some(value)
    }

    pub(crate) fn get_at_or_mut(&mut self, index: usize, key: &K) -> Option<&mut V> {
        let index = if self.get_at(index, key).is_some() {
            index
        } else {
            self.slot(key)?
        };
        self.read_values = None;
        self.entries[index].as_mut().map(|entry| &mut entry.1)
    }

    pub fn get_pair_mut(&mut self, a: &K, b: &K) -> Option<(&mut V, &mut V)> {
        let a = *self.lookup.get(a)?;
        let b = *self.lookup.get(b)?;
        self.read_values = None;
        let [a, b] = self.entries.get_disjoint_mut([a, b]).ok()?;
        Some((&mut a.as_mut()?.1, &mut b.as_mut()?.1))
    }

    pub fn contains_key(&self, key: &K) -> bool {
        self.lookup.contains_key(key)
    }

    pub fn delete(&mut self, key: &K) {
        self.remove(key);
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        let index = self.lookup.remove(key)?;
        self.read_values = None;
        let entry = self.entries[index].take();
        self.compact();
        entry.map(|(_, value)| value)
    }

    pub fn len(&self) -> usize {
        self.lookup.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lookup.is_empty()
    }

    pub fn for_each_mutating(&mut self, mut visit: impl FnMut(&mut Self, K, V))
    where
        V: Clone,
    {
        self.iteration_depth += 1;
        let iteration = Iteration(self);
        let mut index = 0;
        while index < iteration.0.entries.len() {
            if let Some((key, value)) = iteration.0.entries[index].clone() {
                visit(iteration.0, key, value);
            }
            index += 1;
        }
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.entries
            .iter()
            .filter_map(|entry| entry.as_ref().map(|(_, value)| value))
    }

    /// Returns entry slots that may change after compaction or clearing.
    pub(crate) fn indexed_values(&self) -> impl Iterator<Item = (usize, &V)> {
        self.indexed_entries()
            .map(|(index, _, value)| (index, value))
    }

    pub(crate) fn indexed_entries(&self) -> impl Iterator<Item = (usize, &K, &V)> {
        self.entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| entry.as_ref().map(|(key, value)| (index, key, value)))
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.entries
            .iter()
            .flatten()
            .map(|(key, value)| (key, value))
    }

    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut V> {
        self.read_values = None;
        self.entries.iter_mut().flatten().map(|(_, value)| value)
    }

    /// Temporarily move out a value while a world callback looks up or edits others.
    pub(crate) fn take_for_update(&mut self, key: &K) -> Option<V> {
        let index = *self.lookup.get(key)?;
        let (_, value) = self.entries[index].take()?;
        self.read_values = None;
        self.iteration_depth += 1;
        Some(value)
    }

    pub(crate) fn finish_update(&mut self, key: K, value: Option<V>) {
        match value {
            Some(value) => self.set(key, value),
            None => {
                self.lookup.remove(&key);
            }
        }
        self.iteration_depth -= 1;
        self.compact();
    }

    pub fn read_values(&mut self) -> Arc<[V]>
    where
        V: Clone,
    {
        if let Some(values) = &self.read_values {
            return Arc::clone(values);
        }
        let values: Arc<[V]> = self.values().cloned().collect();
        self.read_values = Some(Arc::clone(&values));
        values
    }

    pub fn clear(&mut self) {
        self.read_values = None;
        self.lookup.clear();
        if self.iteration_depth == 0 {
            self.entries.clear();
        } else {
            self.entries.fill_with(|| None);
        }
    }

    fn compact(&mut self) {
        if self.iteration_depth > 0 || self.entries.len() <= 2 * self.len() + 128 {
            return;
        }
        self.entries.retain(Option::is_some);
        for (index, entry) in self.entries.iter().flatten().enumerate() {
            if let Some(location) = self.lookup.get_mut(&entry.0) {
                *location = index;
            }
        }
    }
}

struct Iteration<'a, K: Eq + Hash + Clone, V>(&'a mut OrderedMap<K, V>);

impl<K: Eq + Hash + Clone, V> Drop for Iteration<'_, K, V> {
    fn drop(&mut self) {
        self.0.iteration_depth -= 1;
        self.0.compact();
    }
}

#[cfg(test)]
mod tests {
    use super::OrderedMap;

    #[test]
    fn read_values_retain_the_earlier_list() {
        let mut map = OrderedMap::default();
        map.set(1, 10);
        map.set(2, 20);
        let before = map.read_values();
        map.set(1, 11);
        map.delete(&2);
        map.set(2, 22);
        map.set(3, 33);
        let after = map.read_values();
        assert_eq!(&*before, &[10, 20]);
        assert_eq!(&*after, &[11, 22, 33]);
        map.clear();
        assert!(map.read_values().is_empty());
        assert_eq!(&*after, &[11, 22, 33]);
    }

    #[test]
    fn indexed_access_checks_keys_and_skips_removed_slots() {
        let mut map = OrderedMap::default();
        map.set(1, 10);
        map.set(2, 20);
        map.set(3, 30);
        map.delete(&2);
        map.set(2, 21);

        assert!(map.indexed_values().eq([(0, &10), (2, &30), (3, &21)]));
        assert_eq!(map.get_at_mut(1, &2), None);
        assert_eq!(map.get_at_mut(2, &2), None);
        assert_eq!(map.get_at_mut(4, &2), None);

        let before = map.read_values();
        *map.get_at_mut(3, &2).unwrap() = 22;
        assert_eq!(&*before, &[10, 30, 21]);
        assert_eq!(&*map.read_values(), &[10, 30, 22]);
    }

    #[test]
    fn validated_slot_falls_back_after_compaction() {
        let mut map = OrderedMap::default();
        for key in 0..260 {
            map.set(key, key);
        }
        let slot = map.slot(&200).unwrap();
        assert_eq!(map.get_at(slot, &200), Some(&200));
        for key in 0..198 {
            map.delete(&key);
        }

        assert_ne!(map.slot(&200), Some(slot));
        assert_eq!(map.get_at(slot, &200), None);
        *map.get_at_or_mut(slot, &200).unwrap() = 42;
        assert_eq!(map.get(&200), Some(&42));
        assert_eq!(map.get_at_or_mut(slot, &0), None);
    }

    #[test]
    fn iterator_visits_updated_and_inserted_values() {
        let mut map = OrderedMap::default();
        for key in 1..=3 {
            map.set(key, key);
        }
        let mut seen = Vec::new();
        map.for_each_mutating(|map, key, value| {
            seen.push(key);
            if key == 1 {
                map.set(2, 200);
                map.delete(&3);
                for key in 4..260 {
                    map.set(key, key);
                }
            }
            if key == 2 {
                assert_eq!(value, 200);
            }
        });
        assert!(seen.into_iter().eq([1, 2].into_iter().chain(4..260)));
        for key in 1..200 {
            map.delete(&key);
        }
        for key in 200..260 {
            assert_eq!(map.get(&key), Some(&key));
        }
        map.set(1, 10);
        assert_eq!(map.values().last(), Some(&10));
    }

    #[test]
    fn clear_during_nested_iteration() {
        let mut map = OrderedMap::default();
        map.set(1, 1);
        map.set(2, 2);
        let mut seen = Vec::new();
        let mut nested = Vec::new();
        map.for_each_mutating(|map, key, _| {
            seen.push(key);
            if key == 1 {
                map.clear();
                map.set(3, 3);
                map.for_each_mutating(|_, key, _| nested.push(key));
            }
        });
        assert_eq!(seen, [1, 3]);
        assert_eq!(nested, [3]);
        map.clear();
        map.set(0, 0);
        assert_eq!(map.get(&0), Some(&0));
        assert_eq!(map.len(), 1);
    }
}
