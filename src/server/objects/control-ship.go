// Port of src/client/objects/control-ship.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"slices"
)

func (s *Ship) Control(input protocol.Input, events *[]protocol.SimulationEvent) {
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
	}{{"cargoHatch", input.CargoHatch}, {"searchLight", input.SearchLight}, {"shieldGenerator", input.ShieldGenerator}, {"hornDrill", input.HornDrill}, {"plasmaAccelerator", input.PlasmaActive}, {"autogun", input.AutogunActive}, {"laser", input.LaserActive}}

	for _, control := range controls {
		changed := slices.ContainsFunc(s.Segments, func(segment *simulation.Segment) bool {
			return segment.Module != nil && (segment.Module.ModuleBase().Spec.Behavior == control.id || segment.Module.ModuleBase().Type == control.id) && !(*segment.TargetHealth() < 1) && (segment.Active != 0) != control.enabled
		})

		if !changed {
			continue
		}

		s.SetModuleActive(control.id, control.enabled)

		if control.enabled && !s.ModuleActive(control.id) {
			continue
		}

		if s.PlayerID != nil && control.id != "hornDrill" && control.id != "plasmaAccelerator" && control.id != "autogun" && control.id != "laser" {
			*events = append(*events, protocol.ModuleChanged{Module: control.id, PlayerID: *s.PlayerID, Active: control.enabled})
		}
	}
}
