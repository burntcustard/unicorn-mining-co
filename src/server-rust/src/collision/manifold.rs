//! Local contact manifolds and their world-space contact points.

use crate::vector::{TransformValue, Vector};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ManifoldType {
    #[default]
    None,
    Circles,
    FaceA,
    FaceB,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Manifold {
    pub kind: ManifoldType,
    pub local_normal: Vector,
    pub local_point: Vector,
    pub points: [Vector; 2],
    pub point_count: usize,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WorldManifold {
    pub normal: Vector,
    pub points: [Vector; 2],
    pub separations: [f64; 2],
    pub point_count: usize,
}

impl Manifold {
    pub fn world_manifold(
        self,
        result: &mut WorldManifold,
        xf_a: TransformValue,
        radius_a: f64,
        xf_b: TransformValue,
        radius_b: f64,
    ) {
        if self.point_count == 0 {
            return;
        }
        result.point_count = self.point_count;
        match self.kind {
            ManifoldType::None => (),
            ManifoldType::Circles => {
                let point_a = xf_a.transform(self.local_point);
                let point_b = xf_b.transform(self.points[0]);
                let distance = point_b - point_a;
                let length_squared = distance.length_squared();
                result.normal = if length_squared > 1e-18 {
                    distance * (1.0 / length_squared.sqrt())
                } else {
                    Vector::new(1.0, 0.0)
                };
                let ca = point_a.add_scaled(result.normal, radius_a);
                let cb = point_b.add_scaled(result.normal, -radius_b);
                result.points[0] = Vector::combine2(0.5, ca, 0.5, cb);
                result.separations[0] = (cb - ca).dot(result.normal);
            }
            ManifoldType::FaceA => {
                result.normal = xf_a.q.rotate(self.local_normal);
                let plane_point = xf_a.transform(self.local_point);
                for index in 0..self.point_count {
                    let clip_point = xf_b.transform(self.points[index]);
                    let ca = clip_point.add_scaled(
                        result.normal,
                        radius_a - (clip_point - plane_point).dot(result.normal),
                    );
                    let cb = clip_point.add_scaled(result.normal, -radius_b);
                    result.points[index] = Vector::combine2(0.5, ca, 0.5, cb);
                    result.separations[index] = (cb - ca).dot(result.normal);
                }
            }
            ManifoldType::FaceB => {
                result.normal = xf_b.q.rotate(self.local_normal);
                let plane_point = xf_b.transform(self.local_point);
                for index in 0..self.point_count {
                    let clip_point = xf_a.transform(self.points[index]);
                    let cb = clip_point.add_scaled(
                        result.normal,
                        radius_b - (clip_point - plane_point).dot(result.normal),
                    );
                    let ca = clip_point.add_scaled(result.normal, -radius_a);
                    result.points[index] = Vector::combine2(0.5, ca, 0.5, cb);
                    result.separations[index] = (ca - cb).dot(result.normal);
                }
                result.normal = result.normal * -1.0;
            }
        }
    }
}

pub fn clip_segment_to_line(
    out: &mut [Vector; 2],
    input: [Vector; 2],
    normal: Vector,
    offset: f64,
) -> usize {
    let mut count = 0;
    let d0 = normal.dot(input[0]) - offset;
    let d1 = normal.dot(input[1]) - offset;
    if d0 <= 0.0 {
        out[count] = input[0];
        count += 1;
    }
    if d1 <= 0.0 {
        out[count] = input[1];
        count += 1;
    }
    if d0 * d1 < 0.0 {
        let interpolation = d0 / (d0 - d1);
        out[count] = Vector::combine2(1.0 - interpolation, input[0], interpolation, input[1]);
        count += 1;
    }
    count
}
