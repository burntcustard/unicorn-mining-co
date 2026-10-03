// Port of src/client/protocol/regions.ts. Rendering state is not included.
package protocol

import Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"

type StationDescription struct {
	ID       uint32     `json:"id"`
	Position Vec.Vector `json:"position"`
	Radius   float64    `json:"radius"`
	Spin     float64    `json:"spin"`
	Type     string     `json:"type"`
}

type AsteroidDescription struct {
	Contents   []int      `json:"contents"`
	ID         uint32     `json:"id"`
	PointCount int        `json:"pointCount,omitempty"`
	Position   Vec.Vector `json:"position"`
	Radius     float64    `json:"radius"`
	RadiusEven float64    `json:"radiusEven,omitempty"`
	Resource   int        `json:"resource"`
	Rotation   float64    `json:"rotation"`
	Spin       float64    `json:"spin"`
	Type       string     `json:"type"`
}

// generateRegion retains the whole Field object in clueField, including its
// id and radius, although the TypeScript protocol type only requires position
// and resource. Keep those properties when returning detached descriptions.
type FieldDescription struct {
	ID       uint32     `json:"id,omitempty"`
	Position Vec.Vector `json:"position"`
	Radius   float64    `json:"radius,omitempty"`
	Resource int        `json:"resource"`
}

type WreckDescription struct {
	CargoContents []int            `json:"cargoContents"`
	ClueField     FieldDescription `json:"clueField"`
	ID            uint32           `json:"id"`
	Paint         int              `json:"paint"`
	Position      Vec.Vector       `json:"position"`
	Radius        float64          `json:"radius"`
	Spin          float64          `json:"spin"`
	Type          string           `json:"type"`
}

type RegionDescription struct {
	Asteroids []AsteroidDescription `json:"asteroids"`
	Region    Vec.Vector            `json:"region"`
	Stations  []StationDescription  `json:"stations"`
	Wrecks    []WreckDescription    `json:"wrecks"`
}

type LoadedRegion struct {
	Description *RegionDescription
	Seed        uint32
}

type WorldRanges struct {
	Asteroid       float64 `json:"asteroid"`
	Item           float64 `json:"item"`
	StationMarker  float64 `json:"stationMarker"`
	StationPhysics float64 `json:"stationPhysics"`
	Wreck          float64 `json:"wreck"`
}

func Ranges(values map[string]float64) WorldRanges {
	return WorldRanges{Asteroid: values["asteroid"], Item: values["item"], StationMarker: values["stationMarker"], StationPhysics: values["stationPhysics"], Wreck: values["wreck"]}
}

type RegionalView struct {
	Asteroids      []AsteroidDescription `json:"asteroids"`
	StationMarkers []StationDescription  `json:"stationMarkers"`
	Stations       []StationDescription  `json:"stations"`
	Wrecks         []WreckDescription    `json:"wrecks"`
}
