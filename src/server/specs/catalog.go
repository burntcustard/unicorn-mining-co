package specs

import (
	"encoding/json"
	"fmt"

	"github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type Point [2]float64
type Vector = vector.Vector

type Catalog struct {
	NPCMovement      NPCMovement         `json:"npcMovement"`
	PirateSpec       Pirate              `json:"pirateSpec"`
	CollectorSpec    Collector           `json:"collectorSpec"`
	CollectorDialog  CollectorDialog     `json:"collectorDialog"`
	JumpGateDialog   JumpGateDialog      `json:"jumpGateDialog"`
	PirateDialog     PirateDialog        `json:"pirateDialog"`
	StationModuleIDs []string            `json:"stationModuleIds"`
	PortalSpec       Portal              `json:"portalSpec"`
	JumpGateSpec     JumpGate            `json:"jumpGateSpec"`
	WormholeSpec     Wormhole            `json:"wormholeSpec"`
	JumpGateHull     []HullSegment       `json:"jumpGateHull"`
	SectorNames      []string            `json:"sectorNames"`
	SectorGeneration SectorGeneration    `json:"sectorGeneration"`
	StartingSectorID string              `json:"startingSectorId"`
	StartingCredits  float64             `json:"startingCredits"`
	Colors           map[string][]string `json:"colors"`
	PaintColors      [][]string          `json:"paintColors"`
	ItemDefaults     map[string]float64  `json:"itemDefaults"`
	ItemIDs          []string            `json:"itemIds"`
	ItemSpecs        map[string]Item     `json:"itemSpecs"`
	ModuleIDs        []string            `json:"moduleIds"`
	ModuleSpecs      map[string]Module   `json:"moduleSpecs"`
	ShipSpecs        map[string]Ship     `json:"shipSpecs"`
	StationSpecs     map[string]Station  `json:"stationSpecs"`
	Protocol         Protocol            `json:"protocol"`
	Simulation       Simulation          `json:"simulation"`
	RegionGeneration RegionGeneration    `json:"regionGeneration"`
}

func Load() (Catalog, error) {
	var c Catalog

	if err := json.Unmarshal([]byte(catalogJSON), &c); err != nil {
		return c, err
	}

	for _, id := range c.ModuleIDs {
		if _, ok := c.ModuleSpecs[id]; !ok {
			return c, fmt.Errorf("missing module %q", id)
		}
	}

	for _, id := range c.ItemIDs {
		if _, ok := c.ItemSpecs[id]; !ok {
			return c, fmt.Errorf("missing item %q", id)
		}
	}

	if c.Simulation.SimulationStep <= 0 {
		return c, fmt.Errorf("invalid simulation step")
	}

	return c, nil
}
