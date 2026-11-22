use std::collections::HashMap;
use std::ops::Range;

use smallvec::SmallVec;

use crate::protocol::StationStockUpdate;

#[derive(Debug)]
pub(crate) struct StationStock {
    station_id: u64,
    incarnation: u64,
    entries: Vec<(u64, Range<usize>)>,
    bytes: Vec<u8>,
    indices: HashMap<u64, usize>,
}

impl StationStock {
    pub(crate) fn new(
        station_id: u64,
        incarnation: u64,
        entries: Vec<(u64, Range<usize>)>,
        bytes: Vec<u8>,
    ) -> Self {
        let indices = entries
            .iter()
            .enumerate()
            .map(|(index, (id, _))| (*id, index))
            .collect();
        Self {
            station_id,
            incarnation,
            entries,
            bytes,
            indices,
        }
    }

    fn entry(&self, id: u64) -> Option<&[u8]> {
        self.indices
            .get(&id)
            .map(|&index| self.bytes(&self.entries[index].1))
    }

    fn bytes(&self, range: &Range<usize>) -> &[u8] {
        &self.bytes[range.clone()]
    }
}

pub(super) struct StockPatch<'a> {
    station_id: u64,
    removed: SmallVec<[u64; 8]>,
    changed: SmallVec<[&'a [u8]; 8]>,
    replace: bool,
}

impl<'a> StockPatch<'a> {
    pub(super) fn between(
        previous: Option<&StationStock>,
        current: Option<&'a StationStock>,
    ) -> Option<Self> {
        let Some(current) = current else {
            return previous.map(|_| Self {
                station_id: 0,
                removed: SmallVec::new(),
                changed: SmallVec::new(),
                replace: true,
            });
        };
        let previous = previous.filter(|previous| {
            previous.station_id == current.station_id && previous.incarnation == current.incarnation
        });
        if previous.is_some_and(|previous| std::ptr::eq(previous, current)) {
            return None;
        }
        let removed: SmallVec<[_; 8]> = previous
            .into_iter()
            .flat_map(|old| &old.entries)
            .map(|(id, _)| *id)
            .filter(|id| !current.indices.contains_key(id))
            .collect();
        let changed: SmallVec<[_; 8]> = current
            .entries
            .iter()
            .filter_map(|(id, range)| {
                let data = current.bytes(range);
                (previous.and_then(|old| old.entry(*id)) != Some(data)).then_some(data)
            })
            .collect();
        if previous.is_some() && removed.is_empty() && changed.is_empty() {
            return None;
        }
        Some(Self {
            station_id: current.station_id,
            removed,
            changed,
            replace: previous.is_none(),
        })
    }

    pub(super) fn wire(&self) -> StationStockUpdate<'_> {
        StationStockUpdate {
            station_id: self.station_id,
            replace: self.replace,
            removed_ids: &self.removed,
            entries: &self.changed,
        }
    }
}
