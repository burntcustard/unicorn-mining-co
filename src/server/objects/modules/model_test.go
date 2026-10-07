package modules

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestModelPartOutlines(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range catalog.ModuleIDs {
		original := catalog.ModuleSpecs[id]

		for _, mode := range []string{"outlined", "filled", "mixed"} {
			t.Run(id+"/"+mode, func(t *testing.T) {
				variant := original
				variant.Model = append([]specs.ModelPart(nil), original.Model...)

				for i := range variant.Model {
					outline := mode == "outlined" || mode == "mixed" && i%2 == 0
					variant.Model[i].Outline = &outline
				}

				catalog.ModuleSpecs[id] = variant
				moduleID := int64(1)
				model := Create(id, simulation.ObjectProperties{ID: &moduleID}, catalog).ModuleBase().Model

				if original.Behavior == "searchLight" {
					model = model[1:]
				}

				if len(model) != len(variant.Model) {
					t.Fatalf("got %d model parts, want %d", len(model), len(variant.Model))
				}

				for i, plan := range model {
					part := variant.Model[i]

					if (plan.Stroke == nil) != *part.Outline {
						t.Fatalf("part %d did not retain its outline setting for wreckage", i)
					}

					if (plan.FillShade == nil) != (part.Color == nil) || part.Color != nil && *plan.FillShade != *part.Color {
						t.Fatalf("part %d changed fill color", i)
					}
				}
			})
		}

		catalog.ModuleSpecs[id] = original
	}
}
