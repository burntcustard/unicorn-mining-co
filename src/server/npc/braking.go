package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
brakingControls turns the ordinary engine against excess closing momentum.
Coast through the turn, then project the requested acceleration onto the engine.
Ignore ordinary speed-matching variation and never reverse relative velocity in
one held input, allowing the normal arrival controller to resume smoothly.
*/
func brakingControls(ship *objects.Ship, acceleration, direction, targetVelocity Vec.Vector) (Vec.Vector, float64, bool) {
	interval := ship.Catalog.NPCMovement.DecisionInterval
	relative := Vec.Subtract(ship.Velocity, targetVelocity)
	tolerance := math.Sqrt(ship.Rules.Motion.MinimumSpeedSquared) + max(0, Vec.Dot(targetVelocity, direction))*ship.Drag*interval
	maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass

	if maximum <= 0 || Vec.Dot(relative, direction) <= tolerance || Vec.Dot(acceleration, direction) >= 0 {
		return Vec.Vector{}, 0, false
	}

	forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
	thrust := max(0, min(1, Vec.Dot(acceleration, forward)/maximum))
	thrust = min(thrust, max(0, -Vec.Dot(relative, forward))/(maximum*interval))
	return acceleration, thrust, true
}
