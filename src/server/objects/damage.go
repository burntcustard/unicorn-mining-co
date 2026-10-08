// Port of src/client/objects/damage.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"math"
)

func Damage(object any, amount float64) float64 {
	var health *float64
	var segment *simulation.Segment
	usesActivatedHealth := false

	switch target := object.(type) {
	case *simulation.Segment:
		segment = target
		spec := segment.ModuleSpec()

		if target.Module != nil && spec.Health == 0 && target.Active == 0 {
			return 0
		}

		health = target.TargetHealth()

		// Shield bubbles use activated health; their generator bodies use normal health.
		usesActivatedHealth = spec.HealthActivated != nil && target.Active != 0 && (spec.RechargeDuration == 0 || target.Covers) && target.Mount != nil && target.Mount.HealthActivated != nil

		if usesActivatedHealth {
			health = target.Mount.HealthActivated
		}
	case *simulation.AsteroidSegment:
		health = &target.Health
	case simulation.Entity:
		health = &target.Base().Health
	default:
		panic("unsupported damage target")
	}

	applied := 0.0

	if *health > 0 {
		applied = amount
		*health -= amount

		if entity, ok := object.(simulation.Entity); ok && *health < 1 && entity.Base().Item {
			entity.Base().Remove()
		}
	}

	if segment != nil {
		spec := segment.ModuleSpec()

		if usesActivatedHealth {
			*health = math.Max(0, *health)

			if spec.Health == 0 {
				segment.Mount.Health = *health
			}

			if spec.RechargeDuration > 0 && *health == 0 {
				segment.Active = 0
				segment.ActivationProgress = 0
			}
		}

		for _, mount := range segment.Mounts {
			if mount.Health == 0 || math.IsNaN(mount.Health) {
				continue
			}

			if segment.Health < 1 {
				mount.Health -= mount.Health
			} else if mount.Module != nil && mount.Module.ModuleBase().Spec.DisablePhysics {
				mount.Health -= amount
			}
		}
	}

	return applied
}
