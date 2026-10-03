// Constructor registry from src/client/objects/modules/index.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func Create(id string, props simulation.ObjectProperties, catalog definitions.Catalog) simulation.Module {
	switch catalog.ModuleDefinitions[id].Behavior {
	case "thruster":
		return NewThruster(id, props, catalog)
	case "cargoHatch":
		return NewCargoHatch(props, catalog)
	case "searchLight":
		return NewSearchLight(props, catalog)
	case "hornDrill":
		return NewHornDrill(props, catalog)
	case "shieldGenerator":
		return NewShieldGenerator(props, catalog)
	default:
		panic("Unknown ship module: " + id)
	}
}
