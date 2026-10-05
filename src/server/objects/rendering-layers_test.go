package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestRenderingLayerInheritance(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	craftID, moduleID, stationID := int64(1), int64(2), int64(3)
	craft := NewCraft(Properties{ObjectProperties: simulation.ObjectProperties{ID: &craftID}}, nil, catalog)
	zero := 0
	plan := &simulation.SegmentPlan{}
	module := modules.NewHornDrill(simulation.ObjectProperties{ID: &moduleID}, catalog)
	module.Definition.ZIndex = zero

	if got := makeSegment(craft, nil, plan, nil).ZIndex; got != definitions.HullZIndex {
		t.Fatalf("default hull layer = %d, want %d", got, definitions.HullZIndex)
	}

	if got := makeSegment(craft, module, plan, nil).ZIndex; got != zero {
		t.Fatalf("explicit module layer = %d, want 0", got)
	}

	plan.ZIndex = &zero
	module.Definition.ZIndex = definitions.HullZIndex

	if got := makeSegment(craft, module, plan, nil).ZIndex; got != zero {
		t.Fatalf("explicit segment layer = %d, want 0", got)
	}

	station := NewStation("corral", Properties{ObjectProperties: simulation.ObjectProperties{ID: &stationID}}, catalog)
	floors := 0

	for _, segment := range station.Segments {
		if segment.ZIndex == zero {
			floors++
		}
	}

	if floors != 1 {
		t.Fatalf("station floor segments = %d, want 1", floors)
	}
}
