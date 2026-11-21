use std::num::NonZeroU64;
use std::ops::Index;

const SLOT_BITS: u32 = 24;
const SLOT_MASK: u64 = (1 << SLOT_BITS) - 1;

pub(super) trait Key: Copy + Eq {
    fn from_bits(bits: NonZeroU64) -> Self;
    fn bits(self) -> NonZeroU64;

    fn slot(self) -> usize {
        (self.bits().get() & SLOT_MASK) as usize
    }
}

/// A handle carries its lifetime creation order and its reusable storage slot.
pub(super) struct Arena<K, T> {
    entries: Vec<Option<(K, T)>>,
    free: Vec<usize>,
    serial: u64,
}

impl<K, T> Default for Arena<K, T> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            free: Vec::new(),
            serial: 0,
        }
    }
}

impl<K: Key, T> Arena<K, T> {
    pub(super) fn insert(&mut self, value: T) -> K {
        let slot = self.free.pop().unwrap_or(self.entries.len());
        self.serial += 1;
        assert!(slot as u64 <= SLOT_MASK && self.serial <= u64::MAX >> SLOT_BITS);
        let bits = NonZeroU64::new(self.serial << SLOT_BITS | slot as u64).unwrap();
        let key = K::from_bits(bits);
        let entry = Some((key, value));
        if slot == self.entries.len() {
            self.entries.push(entry);
        } else {
            self.entries[slot] = entry;
        }
        key
    }

    pub(super) fn get(&self, key: &K) -> Option<&T> {
        let (stored, value) = self.entries.get(key.slot())?.as_ref()?;
        (stored == key).then_some(value)
    }

    pub(super) fn get_mut(&mut self, key: &K) -> Option<&mut T> {
        let (stored, value) = self.entries.get_mut(key.slot())?.as_mut()?;
        (stored == key).then_some(value)
    }

    pub(super) fn get_disjoint_mut(&mut self, [a, b]: [&K; 2]) -> [Option<&mut T>; 2] {
        let Ok([first, second]) = self.entries.get_disjoint_mut([a.slot(), b.slot()]) else {
            return [None, None];
        };
        [(first, a), (second, b)].map(|(entry, key)| {
            entry
                .as_mut()
                .and_then(|(stored, value)| (stored == key).then_some(value))
        })
    }

    pub(super) fn remove(&mut self, key: &K) -> Option<T> {
        let slot = key.slot();
        let entry = self.entries.get_mut(slot)?;
        if entry.as_ref().is_some_and(|(stored, _)| stored == key) {
            self.free.push(slot);
            entry.take().map(|(_, value)| value)
        } else {
            None
        }
    }

    pub(super) fn len(&self) -> usize {
        self.entries.len() - self.free.len()
    }
}

impl<K: Key, T> Index<&K> for Arena<K, T> {
    type Output = T;

    fn index(&self, key: &K) -> &T {
        self.get(key).expect("live physics handle")
    }
}

#[cfg(test)]
mod tests {
    use super::super::BodyId;
    use super::{Arena, Key};

    #[test]
    fn recycled_slot_preserves_creation_order_and_rejects_stale_handles() {
        let mut bodies = Arena::<BodyId, i32>::default();
        let first = bodies.insert(1);
        let second = bodies.insert(2);
        assert_eq!(bodies.remove(&first), Some(1));

        let replacement = bodies.insert(3);
        assert_eq!(first.slot(), replacement.slot());
        assert!(first < second && second < replacement);
        assert_eq!(bodies.get(&first), None);
        assert_eq!(bodies.remove(&first), None);
        let [Some(a), Some(b)] = bodies.get_disjoint_mut([&second, &replacement]) else {
            panic!("both live bodies should be available");
        };
        *a += 4;
        *b += 6;
        assert_eq!([bodies[&second], bodies[&replacement]], [6, 9]);
    }
}
