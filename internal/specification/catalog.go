package specification

import (
	"encoding/json"
	"fmt"

	"github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type Point [2]float64
type Vector = vector.Vector
type Catalog struct {
	Colors                map[string][]string `json:"colors"`
	PaintColors           [][]string          `json:"paintColors"`
	ItemDefaults          map[string]float64  `json:"itemDefaults"`
	ItemIDs               []string            `json:"itemIds"`
	ItemSpecifications    map[string]Item     `json:"itemSpecifications"`
	ModuleIDs             []string            `json:"moduleIds"`
	ModuleSpecifications  map[string]Module   `json:"moduleSpecifications"`
	ShipSpecifications    map[string]Ship     `json:"shipSpecifications"`
	StationSpecifications map[string]Station  `json:"stationSpecifications"`
	Protocol              Protocol            `json:"protocol"`
	Simulation            Simulation          `json:"simulation"`
	RegionGeneration      RegionGeneration    `json:"regionGeneration"`
}

func Load() (Catalog, error) {
	var c Catalog
	if err := json.Unmarshal([]byte(catalogJSON), &c); err != nil {
		return c, err
	}
	for _, id := range c.ModuleIDs {
		if _, ok := c.ModuleSpecifications[id]; !ok {
			return c, fmt.Errorf("missing module %q", id)
		}
	}
	for _, id := range c.ItemIDs {
		if _, ok := c.ItemSpecifications[id]; !ok {
			return c, fmt.Errorf("missing item %q", id)
		}
	}
	if c.Simulation.SimulationStep <= 0 {
		return c, fmt.Errorf("invalid simulation step")
	}
	return c, nil
}
