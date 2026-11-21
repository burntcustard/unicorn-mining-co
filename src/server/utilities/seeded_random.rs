/// Deterministic world generator shared with the TypeScript specs.
#[derive(Clone, Copy, Debug)]
pub struct SeededRandom {
    state: f64,
}

impl SeededRandom {
    pub fn new(seed: f64) -> Self {
        Self { state: seed }
    }

    pub fn state(self) -> f64 {
        self.state
    }

    pub fn next_float(&mut self) -> f64 {
        const MULTIPLIER: u64 = 48_271;
        const MODULUS: u64 = 2_147_483_647;

        // Products in this range are exactly representable as f64.
        let integer = self.state as u32;
        self.state = if f64::from(integer) == self.state {
            ((u64::from(integer) + 1) * MULTIPLIER % MODULUS) as f64
        } else {
            ((self.state + 1.0) * MULTIPLIER as f64) % MODULUS as f64
        };

        self.state / MODULUS as f64
    }
}

#[cfg(test)]
mod tests {
    use super::SeededRandom;

    #[test]
    fn matches_floating_remainder() {
        for mut state in [
            0.0,
            1.0,
            25.0,
            2_147_483_646.0,
            2_147_483_647.0,
            f64::from(u32::MAX),
            -1.0,
            -25.0,
            0.5,
            1e20,
            f64::INFINITY,
            f64::NAN,
        ] {
            let mut random = SeededRandom::new(state);
            for _ in 0..10_000 {
                state = ((state + 1.0) * 48_271.0) % 2_147_483_647.0;
                let actual = random.next_float();
                assert!(actual == state / 2_147_483_647.0 || (state.is_nan() && actual.is_nan()));
            }
        }
    }
}
