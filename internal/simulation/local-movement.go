// Port of src/shared/simulation/local-movement.ts.
package simulation

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type MovementParent interface {
	Entity
	Holds(Entity) bool
	Momentum(Vec.Vector) Vec.Vector
}
type movementParent struct {
	entity        Entity
	object        *GameObject
	holder        MovementParent
	radiusSquared float64
	radial        bool
}

func LocalMovement(child Entity, movers []Entity, dt float64) {
	localMovement(child, movers, nil, dt)
}
func localMovement(child Entity, movers []Entity, parents []movementParent, dt float64) {
	object := child.Base()
	parent := object.LocalMovementParent
	if parent != nil {
		p := parent.Base()
		resident := true
		if object.World != nil {
			e, _ := object.World.Entities.Get(p.ID)
			resident = e == parent
		}
		holds := parent.(MovementParent)
		if p.Dead || !resident || !holds.Holds(child) {
			object.Velocity = Vec.Add(object.Velocity, holds.Momentum(object.Position))
			parent = nil
			object.LocalMovementRate = 0
		}
	}
	if parent == nil {
		if parents != nil {
			for _, p := range parents {
				if p.entity == child || p.object.Dead {
					continue
				}
				holds := false
				if p.radial {
					holds = Vec.DistanceSquared(object.Position, p.object.Position) <= p.radiusSquared
				} else {
					holds = p.holder.Holds(child)
				}
				if holds {
					parent = p.entity
					break
				}
			}
		} else {
			for _, mover := range movers {
				if mover == child || mover.Base().Dead {
					continue
				}
				if holder, ok := mover.(MovementParent); ok && holder.Holds(child) {
					parent = mover
					break
				}
			}
		}
	}
	object.LocalMovementParent = parent
	if parent != nil {
		p := parent.Base()
		object.LocalMovementRate = min(1, object.LocalMovementRate+dt)
		angle := p.Spin * dt * object.LocalMovementRate
		x, y := object.Position.X-p.Position.X, object.Position.Y-p.Position.Y
		sin, cos := math.Sincos(angle)
		object.Rotation += angle
		object.Position = Vec.Create(p.Position.X+(x*cos-y*sin), p.Position.Y+(x*sin+y*cos))
	}
}
