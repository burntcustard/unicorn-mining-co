//! Shared motion, mass, and default state for simulation game objects.

use serde::{Deserialize, Serialize};

use crate::specs::{
    GAME_OBJECT_ANGULAR_INERTIA_SCALE, GAME_OBJECT_FRICTION, GAME_OBJECT_MASS, Motion, Point,
    Simulation,
};
use crate::utilities::round_motion_components;
use crate::utilities::vector::Vector;

use super::local_movement::{LocalMovement, MovementParent, MovingObject};
use super::polygon::ShapeOutline;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ObjectProperties {
    pub points: Option<Vec<Point>>,
    pub position: Vector,
    pub velocity: Vector,
    pub rotation: f64,
    pub spin: f64,
    pub mass: Option<f64>,
    pub angular_drag: Option<f64>,
    pub angular_inertia_scale: Option<f64>,
    pub friction: Option<f64>,
    pub radius: Option<f64>,
    pub drag: Option<f64>,
    pub speed_limit: Option<f64>,
    pub decay: Option<f64>,
    pub health: Option<f64>,
    pub bounciness: Option<f64>,
    pub physics: Option<bool>,
    pub buried: Option<bool>,
    pub shape_outline: Option<ShapeOutline>,
    pub message: Option<String>,
    #[serde(alias = "playerId")]
    pub player_number: Option<i64>,
    pub resource: Option<i32>,
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MotionContext<'a> {
    pub maximum_speed: Option<f64>,
    pub decaying: Option<bool>,
    pub current_parent: Option<MovementParent>,
    pub parents: &'a [MovementParent],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MovementOutcome {
    Skipped,
    Moved,
    Died,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GameObject {
    pub id: i64,
    pub position: Vector,
    pub velocity: Vector,
    pub rotation: f64,
    pub spin: f64,
    pub radius: f64,
    #[serde(skip)]
    pub rotation_jump: f64,
    pub physics: bool,
    pub dead: bool,
    pub buried: bool,
    #[serde(skip)]
    pub inactive_physics: bool,
    pub ballistic: bool,
    pub angular_drag: f64,
    pub angular_inertia_scale: f64,
    pub mass: f64,
    pub friction: f64,
    pub drag: f64,
    pub speed_limit: f64,
    pub pending_update_time: f64,
    pub health: f64,
    pub local_movement: LocalMovement,
    pub definition_id: String,
    pub kind: String,
    pub decay: f64,
    pub name: String,
    pub target_label: String,
    pub message: Option<String>,
    // Keep the stored world entity field name for existing saves.
    #[serde(rename = "player_id")]
    pub player_number: Option<i64>,
    pub paint: Option<i32>,
    pub point_count: usize,
    pub resource: Option<i32>,
    pub radius_even: Option<f64>,
    pub shape_outline: Option<ShapeOutline>,
    pub bounciness: Option<f64>,
    pub shades: Option<Vec<String>>,
    pub price: f64,
    pub hostile: bool,
    pub dropped_by: Option<i64>,
    pub pickup_after: u64,
    pub mined: bool,
    pub item: bool,
    pub unlock: String,
    #[serde(skip)]
    motion: Motion,
    #[serde(skip)]
    mass_per_physics_unit: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ObjectHitbox<'a> {
    pub owner: i64,
    pub position: Vector,
    pub rotation: f64,
    pub radius: f64,
    pub outline: Option<&'a [Point]>,
    pub friction: f64,
    pub bounciness: Option<f64>,
    pub physics: bool,
}

impl GameObject {
    pub fn new(id: i64, properties: ObjectProperties, rules: &Simulation) -> Self {
        let mut object = Self {
            id,
            position: properties.position,
            velocity: properties.velocity,
            rotation: properties.rotation,
            spin: properties.spin,
            radius: 0.0,
            rotation_jump: 0.0,
            physics: true,
            dead: false,
            buried: false,
            inactive_physics: false,
            ballistic: false,
            angular_drag: 0.0,
            angular_inertia_scale: GAME_OBJECT_ANGULAR_INERTIA_SCALE,
            mass: GAME_OBJECT_MASS,
            friction: GAME_OBJECT_FRICTION,
            drag: f64::NAN,
            speed_limit: f64::NAN,
            pending_update_time: 0.0,
            health: f64::NAN,
            local_movement: LocalMovement::default(),
            definition_id: String::new(),
            kind: String::new(),
            decay: 0.0,
            name: String::new(),
            target_label: String::new(),
            message: None,
            player_number: None,
            paint: None,
            point_count: 0,
            resource: None,
            radius_even: None,
            shape_outline: None,
            bounciness: None,
            shades: None,
            price: f64::NAN,
            hostile: false,
            dropped_by: None,
            pickup_after: 0,
            mined: false,
            item: false,
            unlock: String::new(),
            motion: rules.motion,
            mass_per_physics_unit: rules.flight.mass_per_physics_unit,
        };
        object.apply_properties(properties);
        object
    }

    pub(crate) fn restore_rules(&mut self, rules: &Simulation) {
        self.motion = rules.motion;
        self.mass_per_physics_unit = rules.flight.mass_per_physics_unit;
    }

    /// Instance properties take precedence over a class's default fields.
    pub fn apply_properties(&mut self, properties: ObjectProperties) {
        self.mass = properties.mass.unwrap_or(self.mass);
        self.angular_drag = properties.angular_drag.unwrap_or(self.angular_drag);
        self.angular_inertia_scale = properties
            .angular_inertia_scale
            .unwrap_or(self.angular_inertia_scale);
        self.friction = properties.friction.unwrap_or(self.friction);
        self.radius = properties.radius.unwrap_or(self.radius);
        self.drag = properties.drag.unwrap_or(self.drag);
        self.speed_limit = properties.speed_limit.unwrap_or(self.speed_limit);
        self.decay = properties.decay.unwrap_or(self.decay);
        self.health = properties.health.unwrap_or(self.health);
        self.physics = properties.physics.unwrap_or(self.physics);
        self.buried = properties.buried.unwrap_or(self.buried);
        self.bounciness = properties.bounciness.or(self.bounciness);
        self.player_number = properties.player_number.or(self.player_number);
        self.resource = properties.resource.or(self.resource);
        if let Some(outline) = properties.shape_outline {
            self.shape_outline = Some(outline);
        }
        if let Some(message) = properties.message {
            self.message = Some(message);
        }
        if let Some(name) = properties.name {
            self.name = name;
        }
    }

    pub fn hitbox(&self) -> Option<ObjectHitbox<'_>> {
        if self.dead || self.buried || (self.radius == 0.0 && self.shape_outline.is_none()) {
            return None;
        }

        Some(ObjectHitbox {
            owner: self.id,
            position: self.position,
            rotation: self.rotation,
            radius: self.radius,
            outline: self
                .shape_outline
                .as_ref()
                .map(|outline| outline.points.as_slice()),
            friction: self.friction,
            bounciness: self.bounciness,
            physics: self.physics,
        })
    }

    pub fn max_speed(&self) -> f64 {
        if self.speed_limit.is_nan() {
            self.motion.default_max_speed
        } else {
            self.speed_limit
        }
    }

    pub fn force_mass(&self) -> f64 {
        if self.kind == "ship" && self.mass_per_physics_unit > 0.0 {
            self.mass / self.mass_per_physics_unit
        } else {
            self.mass
        }
    }

    pub fn round_motion(&mut self) {
        let [x, y, vx, vy, rotation, spin] = round_motion_components([
            self.position.x,
            self.position.y,
            self.velocity.x,
            self.velocity.y,
            self.rotation,
            self.spin,
        ]);
        self.position = Vector::new(x, y);
        self.velocity = Vector::new(vx, vy);
        self.rotation = rotation;
        self.spin = spin;
    }

    /// Change the facing angle immediately, outside the collider sweep.
    pub fn face(&mut self, rotation: f64) {
        self.rotation_jump += rotation - self.rotation;
        self.rotation = rotation;
    }

    pub fn update(&mut self, duration: f64, context: MotionContext<'_>) -> MovementOutcome {
        if self.dead || self.buried {
            return MovementOutcome::Skipped;
        }

        if self.decay != 0.0 && context.decaying.unwrap_or(true) {
            self.health -= self.decay * duration;
            if self.health <= 0.0 {
                self.dead = true;
                return MovementOutcome::Died;
            }
        }

        if self.angular_drag != 0.0 {
            self.spin *= (-self.angular_drag * duration).exp();
            if self.angular_drag > 0.0 && self.spin.abs() < self.motion.minimum_spin {
                self.spin = 0.0;
            }
        }
        self.rotation += self.spin * duration;

        let drag = if self.drag.is_nan() {
            self.motion.default_drag
        } else {
            self.drag
        };
        let max_speed = context.maximum_speed.unwrap_or_else(|| self.max_speed());
        let speed_squared = self.velocity.length_squared();
        if speed_squared < self.motion.minimum_speed_squared {
            self.velocity = Vector::ZERO;
        } else {
            let mut kept = (-drag * duration).exp();

            // Drag still applies when rounded motion sits above its speed limit.
            if max_speed < 0.0 || speed_squared > max_speed * max_speed {
                let speed = speed_squared.sqrt();
                let after_limit = speed * self.motion.max_speed_drag.powf(duration * 60.0);
                kept = if kept.is_nan() || after_limit.is_nan() {
                    f64::NAN
                } else {
                    kept.min(max_speed.max(after_limit) / speed)
                };
            }
            self.velocity = self.velocity * kept;
        }

        self.position = self.position.add_scaled(self.velocity, duration);
        self.local_movement.update(
            MovingObject {
                id: self.id,
                position: &mut self.position,
                velocity: &mut self.velocity,
                rotation: &mut self.rotation,
            },
            context.current_parent,
            context.parents,
            duration,
        );
        self.round_motion();
        MovementOutcome::Moved
    }
}

#[cfg(test)]
mod tests {
    use crate::specs::Flight;

    use super::*;

    #[test]
    fn impulses_use_the_same_mass_conversion_for_ships() {
        let rules = Simulation {
            flight: Flight {
                mass_per_physics_unit: 4175.0 / 9.0,
                ..Flight::default()
            },
            ..Simulation::default()
        };
        for (kind, mass, velocity) in [
            ("ship", 4175.0, 10.0),
            ("ship", 8350.0, 5.0),
            ("asteroid", 9.0, 10.0),
        ] {
            let mut object = GameObject::new(
                1,
                ObjectProperties {
                    mass: Some(mass),
                    ..ObjectProperties::default()
                },
                &rules,
            );
            object.kind = kind.to_owned();
            let mass = object.force_mass();
            crate::physics::apply_force(
                &mut object.velocity,
                &mut object.spin,
                mass,
                Vector::new(90.0, 0.0),
                0.0,
            );
            assert!((object.velocity.x - velocity).abs() <= 1e-10);
        }
    }
}
