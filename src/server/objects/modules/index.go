// Constructor registry from src/client/objects/modules/index.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func Create(id string, props simulation.ObjectProperties, catalog specs.Catalog) simulation.Module {
	switch catalog.ModuleSpecs[id].Behavior {
	case "thruster":
		return NewThruster(id, props, catalog)
	case "cargoHatch":
		return NewCargoHatch(props, catalog)
	case "searchLight":
		return NewSearchLight(props, catalog)
	case "hornDrill":
		return NewHornDrill(props, catalog)
	case "weapon":
		return NewModule(id, props, catalog)
	case "shieldGenerator":
		return newShieldGenerator(id, props, catalog)
	default:
		panic("Unknown ship module: " + id)
	}
}
