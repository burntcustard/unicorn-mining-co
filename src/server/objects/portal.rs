//! Jump gate state transitions and portal travel triggers.

use serde::{Deserialize, Serialize};

use crate::collision::{BaseShape, DistanceInput, SimplexCache, compute_distance};
use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::simulation::geometry::{rotate_point, shape_outline_extent};
use crate::specs::{Catalog, JumpGate, Point};
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;
use crate::utilities::{approach, ease_progress};

pub struct PortalOptions {
    pub id: i64,
    pub position: Vector,
    pub destination_sector: String,
    pub destination_name: String,
    pub wormhole: bool,
}

#[derive(Debug)]
pub struct Portal {
    pub object: GameObject,
    pub opening: f64,
    pub opening_target: f64,
    pub close_after: f64,
    pub blocked_beams: u8,
    pub destination_sector: String,
    pub destination_name: String,
    pub travel_radius: f64,
    pub gate: Option<JumpGate>,
    pub connection_id: String,
    pub target_label: String,
    pub connected: Option<i64>,
    state_hold_remaining: f64,
    requested_target: f64,
    previous_opening: f64,
    closing_started: bool,
    panels: Vec<GatePanel>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct PortalState {
    opening: f64,
    opening_target: f64,
    close_after: f64,
    blocked_beams: u8,
    destination_sector: String,
    destination_name: String,
    connection_id: String,
    target_label: String,
    connected: Option<i64>,
    state_hold_remaining: f64,
    requested_target: f64,
    previous_opening: f64,
}

#[derive(Debug)]
struct GatePanel {
    middle: Vector,
    side: f64,
    radius: f64,
    outline: Vec<Point>,
}

#[derive(Clone, Copy, Debug)]
pub struct GatePanelHitbox<'a> {
    pub index: usize,
    pub local_position: Vector,
    pub position: Vector,
    pub rotation: f64,
    pub radius: f64,
    pub friction: f64,
    pub outline: &'a [Point],
}

impl Portal {
    pub fn new(options: PortalOptions, catalog: &Catalog) -> Self {
        let mut object = GameObject::new(
            options.id,
            ObjectProperties {
                position: options.position,
                mass: Some(f64::INFINITY),
                physics: Some(!options.wormhole),
                ..ObjectProperties::default()
            },
            &catalog.simulation,
        );
        let gate = (!options.wormhole).then(|| catalog.jump_gate_spec.clone());

        let (opening, travel_radius, state_hold_remaining, panels) = if let Some(gate) = &gate {
            object.kind = "jumpGate".into();
            object.name = "Jump Gate".into();
            object.radius = gate.radius;
            object.shades = catalog.colors.get("white").cloned();
            let panels = catalog
                .jump_gate_hull
                .iter()
                .map(|hull| {
                    let ([x, y], radius) = shape_outline_extent(&hull.points);
                    GatePanel {
                        middle: Vector::new(x, y),
                        side: hull.side,
                        radius,
                        outline: hull
                            .points
                            .iter()
                            .map(|point| [point[0] - x, point[1] - y])
                            .collect(),
                    }
                })
                .collect();
            (
                0.0,
                gate.travel_radius,
                gate.state_hold_duration / 1000.0,
                panels,
            )
        } else {
            object.kind = "wormhole".into();
            object.name = "Wormhole".into();
            object.radius = catalog.wormhole_spec.radius;
            (1.0, catalog.wormhole_spec.travel_radius, 0.0, Vec::new())
        };

        Self {
            object,
            opening,
            opening_target: opening,
            close_after: 0.0,
            blocked_beams: 0,
            destination_sector: options.destination_sector,
            destination_name: options.destination_name,
            travel_radius,
            gate,
            connection_id: String::new(),
            target_label: String::new(),
            connected: None,
            state_hold_remaining,
            requested_target: 0.0,
            previous_opening: 0.0,
            closing_started: false,
            panels,
        }
    }

    pub fn connect(&mut self, other: &mut Self) {
        self.connected = Some(other.object.id);
        other.connected = Some(self.object.id);
    }

    pub(crate) fn capture_state(&self) -> PortalState {
        PortalState {
            opening: self.opening,
            opening_target: self.opening_target,
            close_after: self.close_after,
            blocked_beams: self.blocked_beams,
            destination_sector: self.destination_sector.clone(),
            destination_name: self.destination_name.clone(),
            connection_id: self.connection_id.clone(),
            target_label: self.target_label.clone(),
            connected: self.connected,
            state_hold_remaining: self.state_hold_remaining,
            requested_target: self.requested_target,
            previous_opening: self.previous_opening,
        }
    }

    pub(crate) fn restore_state(object: GameObject, state: PortalState, catalog: &Catalog) -> Self {
        let mut portal = Self::new(
            PortalOptions {
                id: object.id,
                position: object.position,
                destination_sector: state.destination_sector,
                destination_name: state.destination_name,
                wormhole: object.kind == "wormhole",
            },
            catalog,
        );
        portal.object = object;
        portal.opening = state.opening;
        portal.opening_target = state.opening_target;
        portal.close_after = state.close_after;
        portal.blocked_beams = state.blocked_beams;
        portal.connection_id = state.connection_id;
        portal.target_label = state.target_label;
        portal.connected = state.connected;
        portal.state_hold_remaining = state.state_hold_remaining;
        portal.requested_target = state.requested_target;
        portal.previous_opening = state.previous_opening;
        portal
    }

    /// Queue access behind the current movement and settled-state hold.
    /// Returns true when the closing transition starts.
    pub fn request_opening(&mut self, target: f64) -> bool {
        self.requested_target = target;
        if self.opening == self.opening_target && self.state_hold_remaining == 0.0 {
            return self.set_target(target);
        }
        false
    }

    /// Occupancy matters only if staying open or requesting closure has an effect.
    pub(crate) fn needs_occupancy(&self, now: f64) -> bool {
        self.opening_target == 1.0
            || (now >= self.close_after
                && (self.opening_target != 0.0 || self.requested_target != 0.0))
    }

    fn set_target(&mut self, target: f64) -> bool {
        if self.opening_target == target {
            return false;
        }
        self.opening_target = target;
        let closing = target == 0.0;
        self.closing_started |= closing;
        closing
    }

    /// Report a closing transition even when an isolated gate advances inside physics.
    pub fn take_closing_start(&mut self) -> bool {
        std::mem::take(&mut self.closing_started)
    }

    pub fn interrupt_closing(&mut self, beams: u8) {
        self.blocked_beams |= beams;
        self.opening_target = 1.0;
        self.requested_target = 1.0;
        self.state_hold_remaining = 0.0;
    }

    /// Exit requests bypass the closed-state hold.
    pub fn request_exit_opening(&mut self) {
        if self.opening == 0.0 && self.opening_target == 0.0 {
            self.state_hold_remaining = 0.0;
        }
        self.request_opening(1.0);
    }

    pub fn contains_interior(&self, position: Vector) -> bool {
        const CORNER_LIMIT: f64 = 274.5;
        let offset = position - self.object.position;
        // Rotation preserves length, and points in the octagon have a smaller
        // length than this bound. Leave space for floating-point roundoff.
        if offset.length_squared() > (CORNER_LIMIT + 1.0).powi(2) {
            return false;
        }
        let local = rotate_point(offset, -self.object.rotation);
        let (x, y) = (local.x.abs(), local.y.abs());
        x < 189.0 && y < 202.5 && x + y < CORNER_LIMIT
    }

    /// Sweep against each finite door beam using the wider endpoint aperture.
    pub fn crossed_beams(&self, from: Vector, to: Vector, radius: f64) -> u8 {
        let Some(gate) = &self.gate else { return 0 };
        let path = BaseShape::segment([
            rotate_point(from - self.object.position, -self.object.rotation),
            rotate_point(to - self.object.position, -self.object.rotation),
        ]);
        let opening = self.opening.max(self.previous_opening);
        let span = gate.half_travel * eased_opening(opening) + gate.beam_inset;
        let transform = TransformValue::default();
        let mut blocked = 0_u8;
        for (index, &y) in gate.beam_offsets.iter().enumerate() {
            let beam = BaseShape::segment([Vector::new(-span, y), Vector::new(span, y)]);
            let distance = compute_distance(
                &mut SimplexCache::default(),
                DistanceInput {
                    proxy_a: &path,
                    proxy_b: &beam,
                    transform_a: transform,
                    transform_b: transform,
                },
            );
            if distance.distance <= radius {
                blocked |= 1_u8.checked_shl(index as u32).unwrap_or(0);
            }
        }

        blocked
    }

    pub fn update(&mut self, duration: f64) -> bool {
        self.connected.is_none() && self.advance(duration)
    }

    pub fn advance(&mut self, mut duration: f64) -> bool {
        self.previous_opening = self.opening;
        let Some(gate) = &self.gate else { return false };
        let (opening, closing, hold) = (
            gate.opening_duration / 1000.0,
            gate.closing_duration / 1000.0,
            gate.state_hold_duration / 1000.0,
        );
        let mut starts_closing = false;
        while duration > 0.0 {
            if self.opening == self.opening_target {
                let wait = duration.min(self.state_hold_remaining);
                self.state_hold_remaining -= wait;
                duration -= wait;
                if self.state_hold_remaining > 0.0 || self.requested_target == self.opening_target {
                    break;
                }
                starts_closing |= self.set_target(self.requested_target);
            }

            let transition_time = if self.opening_target > self.opening {
                opening
            } else {
                closing
            };
            let remaining = (self.opening_target - self.opening).abs() * transition_time;
            let step = duration.min(remaining);
            self.opening = approach(self.opening, self.opening_target, step / transition_time);
            duration -= step;
            if step == remaining {
                self.opening = self.opening_target;
                self.state_hold_remaining = hold;
                if self.opening == 1.0 {
                    self.blocked_beams = 0;
                }
            }
        }

        starts_closing
    }

    fn panel_travel(&self) -> f64 {
        self.gate
            .as_ref()
            .map_or(0.0, |gate| gate.half_travel * eased_opening(self.opening))
    }

    pub fn geometry_source(&self) -> u64 {
        self.panel_travel().to_bits()
    }

    pub fn panel_hitboxes(&self) -> impl Iterator<Item = GatePanelHitbox<'_>> {
        let distance = self.panel_travel();
        let (sin, cos) = self.object.rotation.sin_cos();
        self.panels.iter().enumerate().map(move |(index, panel)| {
            let x = panel.side * distance + panel.middle.x;
            let y = panel.middle.y;
            GatePanelHitbox {
                index,
                local_position: Vector::new(x, y),
                position: self.object.position + Vector::new(x * cos - y * sin, x * sin + y * cos),
                rotation: self.object.rotation,
                radius: panel.radius,
                friction: self.object.friction,
                outline: &panel.outline,
            }
        })
    }

    pub fn crossed(&self, from: Vector, to: Vector) -> bool {
        let delta = to - from;
        let length = delta.length_squared();
        let progress = if length > 0.0 {
            ((self.object.position - from).dot(delta) / length).clamp(0.0, 1.0)
        } else {
            0.0
        };
        from.add_scaled(delta, progress)
            .distance_squared(self.object.position)
            <= self.travel_radius * self.travel_radius
    }
}

fn eased_opening(opening: f64) -> f64 {
    ease_progress(ease_progress(opening))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(catalog: &Catalog) -> Portal {
        Portal::new(
            PortalOptions {
                id: 73,
                position: Vector::new(500.0, 800.0),
                destination_sector: "destination".into(),
                destination_name: "Destination".into(),
                wormhole: false,
            },
            catalog,
        )
    }

    #[test]
    fn panels_use_double_easing_and_preserve_world_pose() -> Result<(), crate::specs::CatalogError>
    {
        let catalog = Catalog::load()?;
        let rules = &catalog.jump_gate_spec;
        let mut gate = gate(&catalog);
        gate.object.rotation = 0.71;
        let settled = [0.051990532036596704, 0.5, 0.9480094679634032, 1.0];

        for target in [1.0, 0.0] {
            gate.update(rules.state_hold_duration / 1000.0);
            gate.request_opening(target);
            let duration = if target == 0.0 {
                rules.closing_duration
            } else {
                rules.opening_duration
            };
            for fraction in settled {
                gate.update(duration / 4000.0);
                let expected = if target == 0.0 {
                    1.0 - fraction
                } else {
                    fraction
                };
                for collider in gate.panel_hitboxes() {
                    let panel = &gate.panels[collider.index];
                    let offset = collider.local_position.x - panel.middle.x;
                    assert!((offset - panel.side * rules.half_travel * expected).abs() <= 1e-9);
                    let expected_position = gate.object.position
                        + rotate_point(collider.local_position, gate.object.rotation);
                    assert!(collider.position.distance(expected_position) <= 1e-9);
                    assert_eq!(collider.rotation, gate.object.rotation);
                }
            }
            assert_eq!(gate.opening, target);
        }

        Ok(())
    }

    #[test]
    fn opening_holds_until_clear_and_crossings_cover_finite_beams()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let rules = &catalog.jump_gate_spec;
        let mut gate = gate(&catalog);
        let hold = rules.state_hold_duration / 1000.0;
        gate.request_opening(1.0);
        gate.update(hold - 0.01);
        assert_eq!(gate.opening_target, 0.0);

        gate.request_exit_opening();
        gate.advance(rules.opening_duration / 1000.0);
        assert_eq!(gate.opening, 1.0);
        gate.request_opening(0.0);
        gate.advance(hold / 2.0);
        assert_eq!(gate.opening_target, 1.0);
        assert!(gate.advance(hold / 2.0 + 0.01));
        assert_eq!(gate.opening_target, 0.0);

        let position = gate.object.position;
        let vertical = Vector::new(0.0, 325.0);
        let cross = gate.crossed_beams(position - vertical, position + vertical, 0.0);
        assert_eq!(cross, 0b1111);
        assert!(gate.crossed(position - vertical, position + vertical));
        let outside = position + Vector::new(400.0, 0.0);
        assert_eq!(
            gate.crossed_beams(outside - vertical, outside + vertical, 0.0),
            0
        );
        assert!(!gate.crossed(outside - vertical, outside + vertical));

        gate.interrupt_closing(cross);
        assert_eq!(gate.blocked_beams, cross);
        assert_eq!(gate.opening_target, 1.0);
        gate.advance(rules.opening_duration / 1000.0);
        assert_eq!(gate.blocked_beams, 0);

        Ok(())
    }
}
