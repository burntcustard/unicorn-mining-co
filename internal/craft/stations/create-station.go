// Port of src/shared/craft/create-station.ts, beside its concrete constructor.
package stations

import (
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

func CreateStation(props craft.Properties, catalog specification.Catalog) *Corral {
	return NewCorral(props, catalog)
}
