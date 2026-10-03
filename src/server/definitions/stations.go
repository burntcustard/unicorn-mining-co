package definitions

type Station struct {
	LocalMovementRadius float64       `json:"localMovementRadius"`
	Mass                float64       `json:"mass"`
	ZIndex              float64       `json:"zIndex"`
	HullSegments        []HullSegment `json:"hullSegments"`
}
