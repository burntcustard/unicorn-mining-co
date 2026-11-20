//! Cached Gilbert–Johnson–Keerthi distance between local shape proxies.

use crate::vector::{TransformValue, Vector};

use super::BaseShape;

#[derive(Clone, Copy, Debug)]
pub struct DistanceInput<'a> {
    pub proxy_a: &'a BaseShape,
    pub proxy_b: &'a BaseShape,
    pub transform_a: TransformValue,
    pub transform_b: TransformValue,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DistanceOutput {
    pub point_a: Vector,
    pub point_b: Vector,
    pub distance: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SimplexCache {
    pub metric: f64,
    pub indices_a: [usize; 3],
    pub indices_b: [usize; 3],
    pub count: usize,
}

pub fn compute_distance(cache: &mut SimplexCache, input: DistanceInput<'_>) -> DistanceOutput {
    let mut simplex = Simplex::read_cache(*cache, input);
    let mut previous = [(0, 0); 3];
    for _ in 0..20 {
        let previous_count = simplex.count;
        for (indices, vertex) in previous.iter_mut().zip(&simplex.vertices[..previous_count]) {
            *indices = (vertex.index_a, vertex.index_b);
        }
        match simplex.count {
            2 => simplex.solve_edge(),
            3 => simplex.solve_triangle(),
            _ => (),
        }
        if simplex.count == 3 {
            break;
        }
        let direction = simplex.search_direction();
        if direction.length_squared() < 1e-18 {
            break;
        }
        let index_a = input
            .proxy_a
            .support(input.transform_a.q.unrotate(direction * -1.0));
        let index_b = input
            .proxy_b
            .support(input.transform_b.q.unrotate(direction));
        if previous[..previous_count].contains(&(index_a, index_b)) {
            break;
        }
        simplex.vertices[simplex.count] = SimplexVertex::new(input, index_a, index_b, 0.0);
        simplex.count += 1;
    }
    let (point_a, point_b) = simplex.witness_points();
    simplex.write_cache(cache);
    DistanceOutput {
        point_a,
        point_b,
        distance: point_a.distance(point_b),
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct SimplexVertex {
    point_a: Vector,
    point_b: Vector,
    index_a: usize,
    index_b: usize,
    difference: Vector,
    weight: f64,
}

impl SimplexVertex {
    fn new(input: DistanceInput<'_>, index_a: usize, index_b: usize, weight: f64) -> Self {
        let point_a = input.transform_a.transform(input.proxy_a.vertex(index_a));
        let point_b = input.transform_b.transform(input.proxy_b.vertex(index_b));
        Self {
            point_a,
            point_b,
            index_a,
            index_b,
            difference: point_b - point_a,
            weight,
        }
    }
}

#[derive(Debug, Default)]
struct Simplex {
    vertices: [SimplexVertex; 3],
    count: usize,
}

impl Simplex {
    fn read_cache(cache: SimplexCache, input: DistanceInput<'_>) -> Self {
        let mut simplex = Self {
            count: cache.count,
            ..Self::default()
        };
        for index in 0..simplex.count {
            simplex.vertices[index] =
                SimplexVertex::new(input, cache.indices_a[index], cache.indices_b[index], 0.0);
        }
        if simplex.count > 1 {
            let metric = simplex.metric();
            if metric < 0.5 * cache.metric || 2.0 * cache.metric < metric || metric < 1e-9 {
                simplex.count = 0;
            }
        }
        if simplex.count == 0 {
            simplex.vertices[0] = SimplexVertex::new(input, 0, 0, 1.0);
            simplex.count = 1;
        }
        simplex
    }

    fn write_cache(&self, cache: &mut SimplexCache) {
        cache.metric = self.metric();
        cache.count = self.count;
        for (index, vertex) in self.vertices[..self.count].iter().enumerate() {
            cache.indices_a[index] = vertex.index_a;
            cache.indices_b[index] = vertex.index_b;
        }
    }

    fn search_direction(&self) -> Vector {
        match self.count {
            1 => -self.vertices[0].difference,
            2 => {
                let edge = self.vertices[1].difference - self.vertices[0].difference;
                if -edge.cross(self.vertices[0].difference) > 0.0 {
                    Vector::new(-edge.y, edge.x)
                } else {
                    Vector::new(edge.y, -edge.x)
                }
            }
            _ => Vector::ZERO,
        }
    }

    fn witness_points(&self) -> (Vector, Vector) {
        let [first, second, third] = self.vertices;
        match self.count {
            1 => (first.point_a, first.point_b),
            2 => (
                Vector::combine2(first.weight, first.point_a, second.weight, second.point_a),
                Vector::combine2(first.weight, first.point_b, second.weight, second.point_b),
            ),
            3 => {
                let point = Vector::combine3(
                    first.weight,
                    first.point_a,
                    second.weight,
                    second.point_a,
                    third.weight,
                    third.point_a,
                );
                (point, point)
            }
            _ => (Vector::ZERO, Vector::ZERO),
        }
    }

    fn metric(&self) -> f64 {
        let [first, second, third] = self.vertices.map(|vertex| vertex.difference);
        match self.count {
            2 => first.distance(second),
            3 => (second - first).cross(third - first),
            _ => 0.0,
        }
    }

    fn solve_edge(&mut self) {
        let first = self.vertices[0].difference;
        let second = self.vertices[1].difference;
        let edge = second - first;
        let d12_2 = -first.dot(edge);
        if d12_2 <= 0.0 {
            self.vertices[0].weight = 1.0;
            self.count = 1;
            return;
        }
        let d12_1 = second.dot(edge);
        if d12_1 <= 0.0 {
            self.vertices[1].weight = 1.0;
            self.count = 1;
            self.vertices[0] = self.vertices[1];
            return;
        }
        let inv_d12 = 1.0 / (d12_1 + d12_2);
        self.vertices[0].weight = d12_1 * inv_d12;
        self.vertices[1].weight = d12_2 * inv_d12;
        self.count = 2;
    }

    fn solve_triangle(&mut self) {
        let [w1, w2, w3] = self.vertices.map(|vertex| vertex.difference);
        let e12 = w2 - w1;
        let (d12_1, d12_2) = (w2.dot(e12), -w1.dot(e12));
        let e13 = w3 - w1;
        let (d13_1, d13_2) = (w3.dot(e13), -w1.dot(e13));
        let e23 = w3 - w2;
        let (d23_1, d23_2) = (w3.dot(e23), -w2.dot(e23));
        let n123 = e12.cross(e13);
        let (d123_1, d123_2, d123_3) = (
            n123 * w2.cross(w3),
            n123 * w3.cross(w1),
            n123 * w1.cross(w2),
        );
        if d12_2 <= 0.0 && d13_2 <= 0.0 {
            self.vertices[0].weight = 1.0;
            self.count = 1;
            return;
        }
        if d12_1 > 0.0 && d12_2 > 0.0 && d123_3 <= 0.0 {
            let inv_d12 = 1.0 / (d12_1 + d12_2);
            self.vertices[0].weight = d12_1 * inv_d12;
            self.vertices[1].weight = d12_2 * inv_d12;
            self.count = 2;
            return;
        }
        if d13_1 > 0.0 && d13_2 > 0.0 && d123_2 <= 0.0 {
            let inv_d13 = 1.0 / (d13_1 + d13_2);
            self.vertices[0].weight = d13_1 * inv_d13;
            self.vertices[2].weight = d13_2 * inv_d13;
            self.count = 2;
            self.vertices[1] = self.vertices[2];
            return;
        }
        if d12_1 <= 0.0 && d23_2 <= 0.0 {
            self.vertices[1].weight = 1.0;
            self.count = 1;
            self.vertices[0] = self.vertices[1];
            return;
        }
        if d13_1 <= 0.0 && d23_1 <= 0.0 {
            self.vertices[2].weight = 1.0;
            self.count = 1;
            self.vertices[0] = self.vertices[2];
            return;
        }
        if d23_1 > 0.0 && d23_2 > 0.0 && d123_1 <= 0.0 {
            let inv_d23 = 1.0 / (d23_1 + d23_2);
            self.vertices[1].weight = d23_1 * inv_d23;
            self.vertices[2].weight = d23_2 * inv_d23;
            self.count = 2;
            self.vertices[0] = self.vertices[2];
            return;
        }
        let inv_d123 = 1.0 / (d123_1 + d123_2 + d123_3);
        self.vertices[0].weight = d123_1 * inv_d123;
        self.vertices[1].weight = d123_2 * inv_d123;
        self.vertices[2].weight = d123_3 * inv_d123;
        self.count = 3;
    }
}
