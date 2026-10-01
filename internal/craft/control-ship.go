// Port of src/shared/craft/control-ship.ts.
package craft

import (
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
)

func (s *Ship) Control(input protocol.Input, events *[]protocol.SimulationEvent) {
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
	}{{"cargoHatch", input.CargoHatch}, {"searchLight", input.SearchLight}, {"shieldGenerator", input.ShieldGenerator}, {"hornDrill", input.HornDrill}}
	running := 0
	for _, segment := range s.Segments {
		if segment.Active == 0 || *segment.TargetHealth() < 1 || segment.Module == nil {
			continue
		}
		for i, control := range controls {
			if segment.Module.ModuleBase().Type == control.id {
				running |= 1 << i
			}
		}
	}
	for i, control := range controls {
		if (running&(1<<i) != 0) == control.enabled {
			continue
		}
		s.SetModuleActive(control.id, control.enabled)
		if s.PlayerID != nil && control.id != "hornDrill" {
			*events = append(*events, protocol.ModuleChanged{Module: control.id, PlayerID: *s.PlayerID, Active: control.enabled})
		}
	}
}
