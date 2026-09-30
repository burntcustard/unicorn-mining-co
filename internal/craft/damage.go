// Port of src/shared/craft/damage.ts.
package craft

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"math"
)

func Damage(object any, amount float64) {
	var health *float64
	var mounts []*simulation.Mount
	var segmentHealth float64
	switch target := object.(type) {
	case *simulation.Segment:
		d := target.ModuleDefinition()
		if d.UnhurtWhen != nil && *d.UnhurtWhen == target.Active {
			return
		}
		health = target.TargetHealth()
		mounts = target.Mounts
		segmentHealth = target.Health
	case *simulation.AsteroidSegment:
		health = &target.Health
	case simulation.Entity:
		health = &target.Base().Health
	default:
		panic("unsupported damage target")
	}
	if *health > 0 {
		*health -= amount
		if entity, ok := object.(simulation.Entity); ok && *health < 1 && entity.Base().Item {
			entity.Base().Remove()
		}
	}
	if segment, ok := object.(*simulation.Segment); ok {
		segmentHealth = segment.Health
	}
	for _, mount := range mounts {
		if mount.Health == 0 || math.IsNaN(mount.Health) {
			continue
		}
		if segmentHealth < 1 {
			mount.Health -= mount.Health
		} else if mount.Module != nil && mount.Module.ModuleBase().Definition.DisablePhysics {
			mount.Health -= amount
		}
	}
}
