// Port of src/client/objects/control-ship.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"slices"
)

func (s *Ship) Control(input protocol.Input, events *[]protocol.SimulationEvent) {
	s.TargetID = input.TargetID

	if s.cargoReleaseHeld && !input.CargoRelease {
		s.CancelCargoRelease()
	}

	s.cargoReleaseHeld = input.CargoRelease

	if s.TransitTime != 0 {
		s.Firing = false
		s.Fly(0, 0)
		return
	}

	s.Firing = input.Fire

	if input.Launch {
		s.Launch()
	}

	forward := max(0, min(1, input.Thrust))

	if s.Launching != 0 || input.Launch {
		forward = 1
	}

	s.Fly(forward, max(-1, min(1, input.Turn)))

	controls := []struct {
		id      string
		enabled bool
	}{{"cargoHatch", input.CargoHatch || input.CargoRelease || s.releasingCargo}, {"searchLight", input.SearchLight}, {"shieldGenerator", input.ShieldGenerator}, {"hornDrill", input.HornDrill}, {"plasmaAccelerator", input.PlasmaActive}, {"plasmaAcceleratorTurret", input.PlasmaActive}, {"autogun", input.AutogunActive}, {"autogunTurret", input.AutogunActive}, {"cannonSm", input.AutogunActive}, {"laser", input.LaserActive}, {"laserTurret", input.LaserActive}}

	for _, control := range controls {
		changed := slices.ContainsFunc(s.Segments, func(segment *simulation.Segment) bool {
			if segment.Module == nil || (segment.Active != 0) == control.enabled || *segment.TargetHealth() < 1 {
				return false
			}

			module := segment.Module.ModuleBase()
			return module.Spec.Behavior == control.id || module.Type == control.id
		})

		if !changed {
			continue
		}

		s.SetModuleActive(control.id, control.enabled)

		if control.enabled && !s.ModuleActive(control.id) {
			continue
		}

		if s.PlayerID != nil && slices.Contains([]string{"cargoHatch", "searchLight", "shieldGenerator"}, control.id) {
			*events = append(*events, protocol.ModuleChanged{Module: control.id, PlayerID: *s.PlayerID, Active: control.enabled})
		}
	}
}
