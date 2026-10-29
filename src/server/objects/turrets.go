package objects

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (s *Ship) updateTurrets(dt float64) {
	if s.World == nil || s.Dead {
		return
	}

	var target simulation.Entity

	if s.TargetID != nil {
		if entity, ok := s.World.Entities.Get(*s.TargetID); ok {
			object := entity.Base()

			if entity != s.Self && !object.Dead && !object.Buried {
				target = entity
			}
		}
	}

	var modules [16]simulation.Module

	for _, module := range s.AppendModules(modules[:0]) {
		data := module.ModuleBase()

		if !data.Spec.Turret || data.Mount == nil || data.Mount.Health <= 0 {
			continue
		}

		active := false

		for _, segment := range s.Segments {
			if segment.Module == module && segment.Active == 1 {
				active = true
				break
			}
		}

		if !active {
			continue
		}

		angle := 0.0

		if target != nil {
			position := Vec.Add(s.Position, simulation.RotatePoint(data.Mount.LocalPosition, s.Rotation))
			direction := Vec.Subtract(target.Base().Position, position)
			angle = math.Atan2(direction.Y, direction.X) - s.Rotation
		}

		difference := angle - data.AimRotation
		turn := math.Atan2(math.Sin(difference), math.Cos(difference))
		limit := data.Spec.TurretTurnRate * dt
		rotation := data.AimRotation + math.Max(-limit, math.Min(limit, turn))
		data.AimRotation = math.Atan2(math.Sin(rotation), math.Cos(rotation))
	}
}

func (s *Ship) weaponPosition(module *simulation.ModuleData, distance float64) Vec.Vector {
	local := simulation.RotatePoint(Vec.Create(distance, 0), module.AimRotation)
	return Vec.Add(s.Position, simulation.RotatePoint(Vec.Add(module.Mount.LocalPosition, local), s.Rotation))
}
