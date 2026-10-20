package npc

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

const SightRange = 1500.0

/*
CanSee detects nearby ships through cover, but requires clear sight beyond 1,000 units.
The outer limit is shared with the NPC's observer so unseen regions reveal no targets.
*/
func CanSee(ship, other *objects.Ship) bool {
	if ship == other || ship.World != other.World || other.Dead || other.DockedTo != nil || other.TransitTime != 0 || !ship.World.Entities.Has(other.ID) {
		return false
	}

	distance := Vec.DistanceSquared(ship.Position, other.Position)

	if distance <= 1000*1000 {
		return true
	}

	if distance > SightRange*SightRange {
		return false
	}

	blocked := false
	direction := Vec.Subtract(other.Position, ship.Position)

	ship.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		object := entity.Base()

		if blocked || object.Dead || object.Buried || object.Kind != "asteroid" && object.Kind != "station" && object.Kind != "jumpGate" {
			return
		}

		// Test the broad circle before reading the remaining physical geometry.
		along := max(0, min(1, Vec.Dot(Vec.Subtract(object.Position, ship.Position), direction)/distance))

		if Vec.DistanceSquared(object.Position, Vec.AddScaled(ship.Position, direction, along)) > object.Radius*object.Radius {
			return
		}

		for _, collider := range entity.Hitbox() {
			segment, _ := collider.Segment.(*simulation.Segment)

			if collider.PickupPoint || collider.Physics != nil && !*collider.Physics && !(object.Kind == "station" && segment != nil && segment.Hull) {
				continue
			}

			if blocksSight(ship.Position, other.Position, collider) {
				blocked = true
				return
			}
		}
	})

	return !blocked
}

/*
blocksSight intersects the actual remaining colliders, including rotated and mined rock.
*/
func blocksSight(from, to Vec.Vector, collider *collision.Collider) bool {
	from = simulation.RotatePoint(Vec.Subtract(from, collider.GetPosition()), -collider.GetRotation())
	to = simulation.RotatePoint(Vec.Subtract(to, collider.GetPosition()), -collider.GetRotation())
	direction := Vec.Subtract(to, from)

	if len(collider.ShapeOutline) == 0 {
		along := max(0, min(1, -Vec.Dot(from, direction)/Vec.LengthSquared(direction)))
		return Vec.LengthSquared(Vec.AddScaled(from, direction, along)) <= collider.GetRadius()*collider.GetRadius()
	}

	inside := false

	for index, point := range collider.ShapeOutline {
		next := collider.ShapeOutline[(index+1)%len(collider.ShapeOutline)]
		start, end := Vec.Create(point[0], point[1]), Vec.Create(next[0], next[1])
		edge := Vec.Subtract(end, start)
		cross := Vec.Cross(direction, edge)

		if math.Abs(cross) > 1e-9 {
			offset := Vec.Subtract(start, from)
			along, side := Vec.Cross(offset, edge)/cross, Vec.Cross(offset, direction)/cross

			if along >= 0 && along <= 1 && side >= 0 && side <= 1 {
				return true
			}
		}

		if (start.Y > from.Y) != (end.Y > from.Y) && from.X < start.X+(from.Y-start.Y)*(end.X-start.X)/(end.Y-start.Y) {
			inside = !inside
		}
	}

	return inside
}
