// Port of src/shared/craft/create-ship.ts. Lives beside Mustang to avoid a Go
// parent/child package import cycle.
package ships

import (
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/modules"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
)

func CreateShip(world *simulation.World, props craft.Properties) *Mustang {
	if props.ID == nil {
		id := simulation.EntityID(world)
		props.ID = &id
	}
	props.World = world
	props.Credits = world.Specification.ShipSpecifications["mustang"].StartingCredits
	ship := NewMustang(props, world.Specification)
	ship.HasCredits = true
	for _, id := range world.Specification.ShipSpecifications["mustang"].StartingModules {
		ship.Fit(modules.Create(id, simulation.ObjectProperties{}, world.Specification), nil)
	}
	return ship
}
