// Port of src/shared/craft/wreckage-segment.ts.
package craft

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type WreckageSegment struct {
	ShapeOutline []simulation.Point `json:"shapeOutline,omitempty"`
	Radius       float64            `json:"radius"`
	Offset       Vec.Vector         `json:"offset"`
	Health       float64            `json:"health"`
	FillShade    *float64           `json:"fillShade,omitempty"`
	Stroke       [][][]float64      `json:"stroke,omitempty"`
}
