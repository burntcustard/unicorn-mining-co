//! The movement scheduler's shared and per-observer visibility ranges.

use crate::specs::{Simulation, UpdateTier};
use crate::utilities::vector::Vector;

#[derive(Clone, Copy)]
struct LimitedObserver {
    position: Vector,
    radius_squared: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ObserverTiers {
    pub visible: UpdateTier,
    pub distant: UpdateTier,
    pub drift: UpdateTier,
    pub visible_range_squared: f64,
}

impl From<&Simulation> for ObserverTiers {
    fn from(rules: &Simulation) -> Self {
        Self {
            visible: rules
                .update_tiers
                .get("visible")
                .copied()
                .unwrap_or_default(),
            distant: rules
                .update_tiers
                .get("distant")
                .copied()
                .unwrap_or_default(),
            drift: rules.update_tiers.get("drift").copied().unwrap_or_default(),
            visible_range_squared: rules.visible_range * rules.visible_range,
        }
    }
}

pub struct Observers {
    positions: Vec<Vector>,
    limited: Vec<LimitedObserver>,
    #[cfg(target_arch = "x86_64")]
    x: Vec<f64>,
    #[cfg(target_arch = "x86_64")]
    y: Vec<f64>,
    #[cfg(target_arch = "x86_64")]
    avx2: bool,
}

impl Default for Observers {
    fn default() -> Self {
        Self {
            positions: Vec::new(),
            limited: Vec::new(),
            #[cfg(target_arch = "x86_64")]
            x: Vec::new(),
            #[cfg(target_arch = "x86_64")]
            y: Vec::new(),
            #[cfg(target_arch = "x86_64")]
            avx2: std::arch::is_x86_feature_detected!("avx2"),
        }
    }
}

impl Observers {
    pub fn clear(&mut self) {
        self.positions.clear();
        self.limited.clear();
        #[cfg(target_arch = "x86_64")]
        {
            self.x.clear();
            self.y.clear();
        }
    }

    pub fn push(&mut self, position: Vector) {
        self.positions.push(position);
        #[cfg(target_arch = "x86_64")]
        {
            self.x.push(position.x);
            self.y.push(position.y);
        }
    }

    /// Even a limited observer with no resident ship makes the default tier distant.
    pub fn push_limited(&mut self, position: Option<Vector>, radius: f64) {
        let observer = match position {
            Some(position) => LimitedObserver {
                position,
                radius_squared: radius * radius,
            },
            None => LimitedObserver {
                position: Vector::ZERO,
                radius_squared: -1.0,
            },
        };
        self.limited.push(observer);
    }

    pub fn within_standard_range(&self, point: Vector, radius_squared: f64) -> bool {
        #[cfg(target_arch = "x86_64")]
        if self.avx2 && self.positions.len() >= 8 {
            // SAFETY: avx2 is checked once on construction. push and clear
            // maintain matching lengths for positions and both coordinate slices.
            return unsafe { within_avx2(point, radius_squared, &self.x, &self.y) };
        }

        self.within_scalar_range(point, radius_squared)
    }

    fn within_scalar_range(&self, point: Vector, radius_squared: f64) -> bool {
        self.positions
            .iter()
            .any(|&observer| point.distance_squared(observer) <= radius_squared)
    }

    pub fn tier_for(
        &self,
        position: Vector,
        velocity: Vector,
        is_craft: bool,
        rules: &ObserverTiers,
    ) -> UpdateTier {
        let default_visible = self.positions.is_empty() && self.limited.is_empty();
        let tier = if default_visible
            || self.within_standard_range(position, rules.visible_range_squared)
            || self.limited.iter().any(|observer| {
                position.distance_squared(observer.position) <= observer.radius_squared
            }) {
            rules.visible
        } else {
            rules.distant
        };

        if tier == rules.visible && velocity == Vector::ZERO && !is_craft {
            rules.drift
        } else {
            tier
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn within_avx2(point: Vector, radius_squared: f64, x: &[f64], y: &[f64]) -> bool {
    use std::arch::x86_64::*;

    let point_x = _mm256_set1_pd(point.x);
    let point_y = _mm256_set1_pd(point.y);
    let squared = _mm256_set1_pd(radius_squared);
    let (x_chunks, x_tail) = x.as_chunks::<4>();
    let (y_chunks, y_tail) = y.as_chunks::<4>();

    for (x, y) in x_chunks.iter().zip(y_chunks) {
        // SAFETY: as_chunks guarantees four readable elements. loadu accepts unaligned data.
        let dx = _mm256_sub_pd(point_x, unsafe { _mm256_loadu_pd(x.as_ptr()) });
        let dy = _mm256_sub_pd(point_y, unsafe { _mm256_loadu_pd(y.as_ptr()) });
        let distances = _mm256_add_pd(_mm256_mul_pd(dx, dx), _mm256_mul_pd(dy, dy));
        if _mm256_movemask_pd(_mm256_cmp_pd::<_CMP_LE_OQ>(distances, squared)) != 0 {
            return true;
        }
    }

    x_tail
        .iter()
        .zip(y_tail)
        .any(|(&x, &y)| point.distance_squared(Vector::new(x, y)) <= radius_squared)
}

#[cfg(test)]
mod tests {
    use crate::utilities::seeded_random::SeededRandom;

    use super::*;

    #[test]
    fn packed_observers_match_scalar_at_boundaries() {
        let mut random = SeededRandom::new(13.0);
        for count in [0, 1, 3, 4, 7, 8, 9, 16, 31, 32, 65] {
            for origin in [0.0, 1e7, -2e7, 1e12] {
                let mut observers = Observers::default();
                for _ in 0..count {
                    observers.push(Vector::new(
                        origin + random.next_float() * 4000.0,
                        origin + random.next_float() * 4000.0,
                    ));
                }

                for trial in 0..1000 {
                    let position = Vector::new(
                        origin + random.next_float() * 5000.0,
                        origin + random.next_float() * 5000.0,
                    );
                    let mut radius = random.next_float() * 2e6;
                    if count > 0 && trial % 3 == 0 {
                        radius = position.distance_squared(observers.positions[trial % count]);
                        if trial % 2 == 0 {
                            radius = radius.next_down();
                        }
                    }

                    assert_eq!(
                        observers.within_standard_range(position, radius),
                        observers.within_scalar_range(position, radius),
                    );
                }
            }
        }
    }

    #[test]
    fn missing_limited_observers_keep_the_distant_tier() -> Result<(), crate::specs::CatalogError> {
        let rules = &ObserverTiers::from(&crate::specs::Catalog::load()?.simulation);
        let mut observers = Observers::default();
        let position = Vector::new(1200.0, 0.0);
        observers.push_limited(None, 200.0);
        assert_eq!(
            observers.tier_for(position, Vector::ZERO, true, rules),
            rules.distant
        );

        observers.clear();
        observers.push_limited(Some(Vector::new(1000.0, 0.0)), 200.0);
        assert_eq!(
            observers.tier_for(position, Vector::ZERO, true, rules),
            rules.visible
        );
        assert_eq!(
            observers.tier_for(position, Vector::ZERO, false, rules),
            rules.drift
        );

        observers.clear();
        observers.push_limited(Some(Vector::new(999.0, 0.0)), 200.0);
        assert_eq!(
            observers.tier_for(position, Vector::ZERO, true, rules),
            rules.distant
        );
        Ok(())
    }
}
