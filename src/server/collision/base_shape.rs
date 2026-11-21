use std::sync::{Arc, OnceLock};

use crate::utilities::{vector::Vector, vector_math::TransformValue};

use super::Aabb;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bound {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub offset_radius: f64,
}

#[derive(Clone, Debug)]
pub struct BaseShape {
    pub radius: f64,
    pub(super) data: Arc<[Vector]>,
    pub(super) count: usize,
    bound: OnceLock<Bound>,
}

impl BaseShape {
    pub(super) fn new(radius: f64, data: Vec<Vector>, count: usize) -> Self {
        Self {
            radius,
            data: data.into(),
            count,
            bound: OnceLock::new(),
        }
    }

    pub fn segment(vertices: [Vector; 2]) -> Self {
        Self::new(0.0, vertices.to_vec(), 2)
    }

    pub fn vertices(&self) -> &[Vector] {
        &self.data[..self.count]
    }

    pub fn vertex(&self, index: usize) -> Vector {
        self.vertices()[index]
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn bound(&self) -> &Bound {
        self.bound.get_or_init(|| {
            let mut center = Vector::ZERO;
            for &vertex in self.vertices() {
                center += vertex;
            }
            center.x /= self.count() as f64;
            center.y /= self.count() as f64;
            let mut radius = 0.0_f64;
            for &vertex in self.vertices() {
                radius = radius.max(vertex.distance(center));
            }
            Bound {
                x: center.x,
                y: center.y,
                radius,
                offset_radius: center.length(),
            }
        })
    }

    pub fn support(&self, direction: Vector) -> usize {
        let mut best_index = usize::MAX;
        let mut best_value = f64::NEG_INFINITY;
        for (index, &vertex) in self.vertices().iter().enumerate() {
            let value = vertex.dot(direction);
            if value > best_value {
                best_index = index;
                best_value = value;
            }
        }
        best_index
    }

    pub fn compute_aabb(&self, transform: TransformValue) -> Aabb {
        let mut aabb = Aabb::EMPTY;
        if self.count == 1 {
            let point = transform.transform(self.vertex(0));
            aabb.lower_bound = point;
            aabb.upper_bound = point;
        } else {
            for &vertex in self.vertices() {
                let point = transform.transform(vertex);
                aabb.lower_bound.x = aabb.lower_bound.x.min(point.x);
                aabb.lower_bound.y = aabb.lower_bound.y.min(point.y);
                aabb.upper_bound.x = aabb.upper_bound.x.max(point.x);
                aabb.upper_bound.y = aabb.upper_bound.y.max(point.y);
            }
        }
        aabb.extend(self.radius);
        aabb
    }
}
