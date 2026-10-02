// Port of the constructor registry in src/shared/items/index.ts.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

func Types(spec specification.Catalog) []func(simulation.ObjectProperties) simulation.Entity {
	constructors := map[string]func(simulation.ObjectProperties) simulation.Entity{
		"diamond":  func(p simulation.ObjectProperties) simulation.Entity { return NewDiamond(p, spec) },
		"amethyst": func(p simulation.ObjectProperties) simulation.Entity { return NewAmethyst(p, spec) },
		"gold":     func(p simulation.ObjectProperties) simulation.Entity { return NewGold(p, spec) },
		"opal":     func(p simulation.ObjectProperties) simulation.Entity { return NewOpal(p, spec) },
		"message":  func(p simulation.ObjectProperties) simulation.Entity { return NewMessage(p, spec) },
	}
	types := make([]func(simulation.ObjectProperties) simulation.Entity, len(spec.ItemIDs))
	for i, id := range spec.ItemIDs {
		types[i] = constructors[id]
	}
	return types
}
