// Constructor registry from src/shared/modules/index.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

func Create(id string, props simulation.ObjectProperties, catalog specification.Catalog) simulation.Module {
	switch id {
	case "thrusterSingle":
		return NewThrusterSingle(props, catalog)
	case "thrusterDualMd":
		return NewThrusterDualMd(props, catalog)
	case "thrusterDualXl":
		return NewThrusterDualXl(props, catalog)
	case "thrusterTriple":
		return NewThrusterTriple(props, catalog)
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
