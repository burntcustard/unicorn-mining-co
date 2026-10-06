package specs

type Station struct {
	LocalMovementRadius float64       `json:"localMovementRadius"`
	Mass                float64       `json:"mass"`
	ZIndex              int           `json:"zIndex"`
	HullSegments        []HullSegment `json:"hullSegments"`
}
