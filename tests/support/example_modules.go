// Synthetic module data shared with TypeScript mechanics tests.
package testsupport

import (
	_ "embed"
	"encoding/json"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

//go:embed example-modules.json
var exampleModulesJSON []byte

// Load replaces module data in a fresh, isolated catalog, retaining wire slots.
func Load() (specs.Catalog, error) {
	catalog, err := specs.Load()

	if err != nil {
		return catalog, err
	}

	var examples specs.Catalog

	if err = json.Unmarshal(exampleModulesJSON, &examples); err != nil {
		return catalog, err
	}

	for id, example := range examples.ModuleSpecs {
		catalog.ModuleSpecs[id] = example
	}

	for id, example := range examples.ItemSpecs {
		catalog.ItemSpecs[id] = example
	}

	return catalog, nil
}
