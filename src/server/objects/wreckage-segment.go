// Port of src/client/objects/wreckage-segment.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type WreckageSegment struct {
	Color        string             `json:"color,omitempty"`
	ShapeOutline []simulation.Point `json:"shapeOutline,omitempty"`
	Radius       float64            `json:"radius"`
	Offset       Vec.Vector         `json:"offset"`
	Health       float64            `json:"health"`
	FillShade    *float64           `json:"fillShade,omitempty"`
	Stroke       [][][]float64      `json:"stroke,omitempty"`
}
