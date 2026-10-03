package definitions

import (
	"encoding/json"
	"fmt"

	"github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type Point [2]float64
type Vector = vector.Vector

type Catalog struct {
	Colors             map[string][]string `json:"colors"`
	PaintColors        [][]string          `json:"paintColors"`
	ItemDefaults       map[string]float64  `json:"itemDefaults"`
	ItemIDs            []string            `json:"itemIds"`
	ItemDefinitions    map[string]Item     `json:"itemDefinitions"`
	ModuleIDs          []string            `json:"moduleIds"`
	ModuleDefinitions  map[string]Module   `json:"moduleDefinitions"`
	ShipDefinitions    map[string]Ship     `json:"shipDefinitions"`
	StationDefinitions map[string]Station  `json:"stationDefinitions"`
	Protocol           Protocol            `json:"protocol"`
	Simulation         Simulation          `json:"simulation"`
	RegionGeneration   RegionGeneration    `json:"regionGeneration"`
}

func Load() (Catalog, error) {
	var c Catalog

	if err := json.Unmarshal([]byte(catalogJSON), &c); err != nil {
		return c, err
	}

	for _, id := range c.ModuleIDs {
		if _, ok := c.ModuleDefinitions[id]; !ok {
			return c, fmt.Errorf("missing module %q", id)
		}
	}

	for _, id := range c.ItemIDs {
		if _, ok := c.ItemDefinitions[id]; !ok {
			return c, fmt.Errorf("missing item %q", id)
		}
	}

	if c.Simulation.SimulationStep <= 0 {
		return c, fmt.Errorf("invalid simulation step")
	}

	return c, nil
}
