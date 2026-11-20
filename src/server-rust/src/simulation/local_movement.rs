use serde::{Deserialize, Serialize};

use crate::vector::Vector;

#[derive(Clone, Copy, Debug)]
pub struct MovementParent {
    pub id: i64,
    pub position: Vector,
    pub spin: f64,
    pub radius_squared: f64,
    pub resident: bool,
    pub dead: bool,
}

impl MovementParent {
    pub fn radial(id: i64, position: Vector, spin: f64, radius: f64) -> Self {
        Self {
            id,
            position,
            spin,
            radius_squared: radius * radius,
            resident: true,
            dead: false,
        }
    }

    fn holds(self, position: Vector) -> bool {
        self.resident
            && !self.dead
            && position.distance_squared(self.position) <= self.radius_squared
    }

    fn momentum(self, position: Vector) -> Vector {
        let offset = position - self.position;
        Vector::new(-offset.y * self.spin, offset.x * self.spin)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct LocalMovement {
    pub parent: Option<i64>,
    pub rate: f64,
    #[serde(skip)]
    last_parent: Option<MovementParent>,
}

impl LocalMovement {
    /// Apply the holder's local rotation or inherit its momentum on departure.
    pub fn update(
        &mut self,
        motion: MovingObject<'_>,
        current_parent: Option<MovementParent>,
        parents: &[MovementParent],
        duration: f64,
    ) {
        let mut parent = None;
        if let Some(id) = self.parent {
            let current = current_parent
                .filter(|parent| parent.id == id)
                .or_else(|| parents.iter().copied().find(|parent| parent.id == id))
                .or_else(|| {
                    self.last_parent.map(|parent| MovementParent {
                        resident: false,
                        ..parent
                    })
                });

            if let Some(current) = current {
                if current.holds(*motion.position) {
                    parent = Some(current);
                } else {
                    *motion.velocity += current.momentum(*motion.position);
                    self.rate = 0.0;
                }
            } else {
                self.rate = 0.0;
            }
        }

        if parent.is_none() {
            parent = parents
                .iter()
                .copied()
                .find(|parent| parent.id != motion.id && parent.holds(*motion.position));
        }

        self.parent = parent.map(|parent| parent.id);
        self.last_parent = parent;
        if let Some(parent) = parent {
            self.rate = (self.rate + duration).min(1.0);
            let angle = parent.spin * duration * self.rate;
            let offset = *motion.position - parent.position;
            let (sin, cos) = angle.sin_cos();
            *motion.rotation += angle;
            *motion.position = parent.position
                + Vector::new(
                    offset.x * cos - offset.y * sin,
                    offset.x * sin + offset.y * cos,
                );
        }
    }
}

pub struct MovingObject<'a> {
    pub id: i64,
    pub position: &'a mut Vector,
    pub velocity: &'a mut Vector,
    pub rotation: &'a mut f64,
}
