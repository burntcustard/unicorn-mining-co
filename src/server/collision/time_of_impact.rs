//! Conservative advancement and root finding for continuous collision detection.

use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use crate::physics::motion_sweep::Sweep;

use super::{BaseShape, DistanceInput, SimplexCache, compute_distance};

pub struct ToiInput<'a> {
    pub proxy_a: &'a BaseShape,
    pub proxy_b: &'a BaseShape,
    pub sweep_a: &'a mut Sweep,
    pub sweep_b: &'a mut Sweep,
    pub t_max: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToiOutput {
    pub touching: bool,
    pub t: f64,
}

pub fn find_time_of_impact(input: ToiInput<'_>, linear_slop: f64) -> ToiOutput {
    let ToiInput {
        proxy_a,
        proxy_b,
        sweep_a,
        sweep_b,
        t_max,
    } = input;
    sweep_a.normalize();
    sweep_b.normalize();
    let target = linear_slop.max(proxy_a.radius + proxy_b.radius - 3.0 * linear_slop);
    let tolerance = 0.25 * linear_slop;
    let max_push_back_iterations = 12.max(proxy_a.count()).max(proxy_b.count());
    let mut t1 = 0.0;
    let mut cache = SimplexCache::default();
    for _ in 0..20 {
        let transform_a = sweep_a.transform(t1);
        let transform_b = sweep_b.transform(t1);
        let distance_input = DistanceInput {
            proxy_a,
            proxy_b,
            transform_a,
            transform_b,
        };
        let distance = compute_distance(&mut cache, distance_input);
        if distance.distance <= 0.0 {
            return ToiOutput {
                touching: false,
                t: 0.0,
            };
        }
        if distance.distance < target + tolerance {
            return ToiOutput {
                touching: true,
                t: t1,
            };
        }

        let mut separation = Separation::new(cache, distance_input);
        let mut t2 = t_max;
        for _ in 0..max_push_back_iterations {
            let mut s2 = separation.compute(
                proxy_a,
                sweep_a.transform(t2),
                proxy_b,
                sweep_b.transform(t2),
                true,
            );
            if s2 > target + tolerance {
                return ToiOutput {
                    touching: false,
                    t: t_max,
                };
            }
            if s2 > target - tolerance {
                t1 = t2;
                break;
            }
            let mut s1 = separation.compute(
                proxy_a,
                sweep_a.transform(t1),
                proxy_b,
                sweep_b.transform(t1),
                false,
            );
            if s1 < target - tolerance {
                return ToiOutput {
                    touching: false,
                    t: t1,
                };
            }
            if s1 <= target + tolerance {
                return ToiOutput {
                    touching: true,
                    t: t1,
                };
            }

            let (mut a1, mut a2) = (t1, t2);
            for iteration in 0..50 {
                let t = if iteration & 1 == 0 {
                    0.5 * (a1 + a2)
                } else {
                    a1 + ((target - s1) * (a2 - a1)) / (s2 - s1)
                };
                let s = separation.compute(
                    proxy_a,
                    sweep_a.transform(t),
                    proxy_b,
                    sweep_b.transform(t),
                    false,
                );
                if (s - target).abs() < tolerance {
                    t2 = t;
                    break;
                }
                if s > target {
                    a1 = t;
                    s1 = s;
                } else {
                    a2 = t;
                    s2 = s;
                }
            }
        }
    }
    ToiOutput {
        touching: false,
        t: t1,
    }
}

enum SeparationKind {
    Points,
    FaceA { local_point: Vector },
    FaceB { local_point: Vector },
}

struct Separation {
    kind: SeparationKind,
    axis: Vector,
    index_a: usize,
    index_b: usize,
}

impl Separation {
    fn new(cache: SimplexCache, input: DistanceInput<'_>) -> Self {
        let DistanceInput {
            proxy_a,
            proxy_b,
            transform_a,
            transform_b,
        } = input;
        let (kind, axis) = if cache.count == 1 {
            let point_a = transform_a.transform(proxy_a.vertex(cache.indices_a[0]));
            let point_b = transform_b.transform(proxy_b.vertex(cache.indices_b[0]));
            (SeparationKind::Points, (point_b - point_a).normalized())
        } else if cache.indices_a[0] == cache.indices_a[1] {
            let first = proxy_b.vertex(cache.indices_b[0]);
            let second = proxy_b.vertex(cache.indices_b[1]);
            let mut axis = (second - first).cross_scalar(1.0).normalized();
            let normal = transform_b.q.rotate(axis);
            let local_point = Vector::combine2(0.5, first, 0.5, second);
            let point_b = transform_b.transform(local_point);
            let point_a = transform_a.transform(proxy_a.vertex(cache.indices_a[0]));
            if point_a.dot(normal) - point_b.dot(normal) < 0.0 {
                axis = axis * -1.0;
            }
            (SeparationKind::FaceB { local_point }, axis)
        } else {
            let first = proxy_a.vertex(cache.indices_a[0]);
            let second = proxy_a.vertex(cache.indices_a[1]);
            let mut axis = (second - first).cross_scalar(1.0).normalized();
            let normal = transform_a.q.rotate(axis);
            let local_point = Vector::combine2(0.5, first, 0.5, second);
            let point_a = transform_a.transform(local_point);
            let point_b = transform_b.transform(proxy_b.vertex(cache.indices_b[0]));
            if point_b.dot(normal) - point_a.dot(normal) < 0.0 {
                axis = axis * -1.0;
            }
            (SeparationKind::FaceA { local_point }, axis)
        };
        Self {
            kind,
            axis,
            index_a: 0,
            index_b: 0,
        }
    }

    fn compute(
        &mut self,
        proxy_a: &BaseShape,
        xf_a: TransformValue,
        proxy_b: &BaseShape,
        xf_b: TransformValue,
        find: bool,
    ) -> f64 {
        match self.kind {
            SeparationKind::Points => {
                if find {
                    self.index_a = proxy_a.support(xf_a.q.unrotate(self.axis));
                    self.index_b = proxy_b.support(xf_b.q.unrotate(self.axis * -1.0));
                }
                let point_a = xf_a.transform(proxy_a.vertex(self.index_a));
                let point_b = xf_b.transform(proxy_b.vertex(self.index_b));
                point_b.dot(self.axis) - point_a.dot(self.axis)
            }
            SeparationKind::FaceA { local_point } => {
                let normal = xf_a.q.rotate(self.axis);
                let point_a = xf_a.transform(local_point);
                if find {
                    self.index_b = proxy_b.support(xf_b.q.unrotate(normal * -1.0));
                }
                let point_b = xf_b.transform(proxy_b.vertex(self.index_b));
                point_b.dot(normal) - point_a.dot(normal)
            }
            SeparationKind::FaceB { local_point } => {
                let normal = xf_b.q.rotate(self.axis);
                let point_b = xf_b.transform(local_point);
                if find {
                    self.index_a = proxy_a.support(xf_a.q.unrotate(normal * -1.0));
                }
                let point_a = xf_a.transform(proxy_a.vertex(self.index_a));
                point_a.dot(normal) - point_b.dot(normal)
            }
        }
    }
}
