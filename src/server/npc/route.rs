//! Bounded clearance-aware A* routes around clusters of terrain.
use crate::specs::NpcMovement;
use crate::utilities::vector::Vector;

use super::perception::{Obstacle, clear_segment};

#[derive(Clone, Copy)]
pub struct RouteOptions {
    pub position: Vector,
    pub target: Vector,
    pub ship_radius: f64,
    pub minimum_speed_squared: f64,
    pub simulation_step: f64,
    pub tick: u64,
    pub rules: NpcMovement,
}

#[derive(Default)]
pub struct RoutePlan {
    points: Vec<Vector>,
    obstacles: Vec<Obstacle>,
    target: Vector,
    tick: u64,
    partial: bool,
}

impl RoutePlan {
    /// Returns the visible destination or the next usable waypoint and whether a detour is active.
    pub fn waypoint(&mut self, options: RouteOptions, obstacles: &[Obstacle]) -> (Vector, bool) {
        let RouteOptions {
            position,
            target,
            ship_radius,
            minimum_speed_squared,
            simulation_step,
            tick,
            rules,
        } = options;
        let radius = ship_radius + rules.clearance_distance;
        self.obstacles.clear();
        self.obstacles.extend(
            obstacles
                .iter()
                .filter(|obstacle| {
                    obstacle.polygon.is_some()
                        || obstacle.velocity.length_squared() < minimum_speed_squared
                })
                .cloned(),
        );
        let obstacles = &self.obstacles;
        if clear_segment(position, target, radius, obstacles, true) {
            self.points.clear();
            self.partial = false;
            return (target, false);
        }
        let stale = tick.wrapping_sub(self.tick) as f64 * simulation_step > 4.0;
        let arrived = self.partial
            && self
                .points
                .last()
                .is_some_and(|&point| position.distance(point) < 25.0);
        if self.points.is_empty()
            || stale
            || arrived
            || self.target.distance(target) > rules.replan_distance
            || !clear_segment(position, self.points[0], radius, obstacles, true)
        {
            self.points = plan_route(position, target, radius, obstacles);
            self.target = target;
            self.tick = tick;
            self.partial = position.distance(target) > 1800.0;
        }
        if self.points.is_empty() {
            return (position, true);
        }
        let next = self
            .points
            .iter()
            .rposition(|&point| clear_segment(position, point, radius, obstacles, true))
            .unwrap_or(0);
        self.points.drain(..next);
        let waypoint = self.points[0];
        let offset = waypoint - position;
        let distance = offset.length();
        let waypoint = if distance > rules.route_lookahead {
            position.add_scaled(offset, rules.route_lookahead / distance)
        } else {
            waypoint
        };
        (waypoint, true)
    }
}

pub fn plan_route(
    from: Vector,
    mut target: Vector,
    radius: f64,
    obstacles: &[Obstacle],
) -> Vec<Vector> {
    let offset = target - from;
    if offset.length() > 1800.0 {
        target = from.add_scaled(offset.normalized(), 1800.0);
    }
    let cell = radius.clamp(24.0, 48.0);
    let mut path = Vec::new();
    let mut length = f64::INFINITY;
    let mut remaining = f64::INFINITY;
    let precise = obstacles.iter().any(|object| object.polygon.is_some());
    for attempt in 0..3 {
        if attempt == 2 && !precise
            || !path.is_empty()
                && length <= from.distance(target) * 1.4
                && (remaining <= cell * 2.0
                    || !clear_segment(target, target, radius, obstacles, false))
        {
            break;
        }
        let spacing = if attempt == 0 { cell } else { cell * 0.5 };
        let candidate = grid_route(from, target, radius, spacing, obstacles, attempt == 2);
        if candidate.is_empty() {
            continue;
        }
        let mut distance = 0.0;
        let mut previous = from;
        for &point in &candidate {
            distance += previous.distance(point);
            previous = point;
        }
        let gap = previous.distance(target);
        if gap < remaining - 1.0 || (gap - remaining).abs() <= 1.0 && distance < length {
            path = candidate;
            length = distance;
            remaining = gap;
        }
    }
    path
}

fn grid_route(
    from: Vector,
    target: Vector,
    radius: f64,
    cell: f64,
    obstacles: &[Obstacle],
    outline: bool,
) -> Vec<Vector> {
    let offset = target - from;
    let margin = 900.0;
    let left = ((0.0_f64.min(offset.x) - margin) / cell).floor() as isize;
    let top = ((0.0_f64.min(offset.y) - margin) / cell).floor() as isize;
    let right = ((0.0_f64.max(offset.x) + margin) / cell).ceil() as isize;
    let bottom = ((0.0_f64.max(offset.y) + margin) / cell).ceil() as isize;
    let (width, height) = (right - left + 1, bottom - top + 1);
    let count = (width * height) as usize;
    let point = |index: usize| {
        from + Vector::new(
            (index as isize % width + left) as f64 * cell,
            (index as isize / width + top) as f64 * cell,
        )
    };
    let box_min = from + Vector::new(left as f64 * cell, top as f64 * cell);
    let box_max = from + Vector::new(right as f64 * cell, bottom as f64 * cell);
    let nearby: Vec<_> = obstacles
        .iter()
        .filter(|object| {
            let reach = object.radius + radius;
            object.position.x + reach >= box_min.x
                && object.position.x - reach <= box_max.x
                && object.position.y + reach >= box_min.y
                && object.position.y - reach <= box_max.y
        })
        .collect();
    let mut cost = vec![f64::INFINITY; count];
    let mut parent = vec![usize::MAX; count];
    let mut passable = vec![0_i8; count];
    let mut closed = vec![false; count];
    let mut free = |index: usize| {
        if passable[index] == 0 {
            let position = point(index);
            let blocked = nearby.iter().any(|object| {
                let reach = object.radius + radius;
                position.distance_squared(object.position) < reach * reach
                    && (!outline || object.distance(position) < radius)
            });
            passable[index] = if blocked { -1 } else { 1 };
        }
        passable[index] == 1
    };
    let start = (-left - top * width) as usize;
    cost[start] = 0.0;
    let mut closest = from.distance(target);
    let mut best = start;
    let mut finished = false;
    let mut queue = RouteQueue(vec![RouteNode {
        index: start,
        score: closest,
    }]);
    while let Some(RouteNode { index: current, .. }) = queue.pop() {
        if closed[current] {
            continue;
        }
        closed[current] = true;
        let position = point(current);
        let distance = position.distance(target);
        if distance < closest {
            best = current;
            closest = distance;
        }
        if distance < cell * 2.0
            && clear_segment(
                position,
                target,
                radius,
                nearby.iter().copied(),
                current == start,
            )
        {
            best = current;
            finished = true;
            break;
        }
        let reach = if current == start { 4 } else { 1 };
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let (x, y) = (current as isize % width + dx, current as isize / width + dy);
                if !(0..width).contains(&x) || !(0..height).contains(&y) {
                    continue;
                }
                let next = (y * width + x) as usize;
                if closed[next] || !free(next) {
                    continue;
                }
                let to = point(next);
                let candidate = cost[current] + position.distance(to);
                if candidate >= cost[next]
                    || !clear_segment(
                        position,
                        to,
                        radius,
                        nearby.iter().copied(),
                        current == start,
                    )
                {
                    continue;
                }
                cost[next] = candidate;
                parent[next] = current;
                queue.push(RouteNode {
                    index: next,
                    score: candidate + to.distance(target),
                });
            }
        }
    }
    if best == start {
        return Vec::new();
    }
    let mut reverse = Vec::new();
    if finished {
        reverse.push(target);
    }
    let mut current = best;
    while current != start && current != usize::MAX {
        reverse.push(point(current));
        current = parent[current];
    }
    reverse.reverse();
    reverse
}

#[derive(Clone, Copy)]
struct RouteNode {
    index: usize,
    score: f64,
}

struct RouteQueue(Vec<RouteNode>);

impl RouteQueue {
    fn push(&mut self, value: RouteNode) {
        let mut child = self.0.len();
        self.0.push(value);
        while child > 0 {
            let parent = (child - 1) / 2;
            if self.0[child].score.partial_cmp(&self.0[parent].score)
                != Some(std::cmp::Ordering::Less)
            {
                break;
            }
            self.0.swap(child, parent);
            child = parent;
        }
    }

    fn pop(&mut self) -> Option<RouteNode> {
        if self.0.is_empty() {
            return None;
        }
        let value = self.0.swap_remove(0);
        let mut parent = 0;
        let last = self.0.len();
        while 2 * parent + 1 < last {
            let mut child = 2 * parent + 1;
            if child + 1 < last && self.0[child + 1].score < self.0[child].score {
                child += 1;
            }
            if self.0[child].score.partial_cmp(&self.0[parent].score)
                != Some(std::cmp::Ordering::Less)
            {
                break;
            }
            self.0.swap(parent, child);
            parent = child;
        }
        Some(value)
    }
}
