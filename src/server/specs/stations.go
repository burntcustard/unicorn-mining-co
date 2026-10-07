package specs

type Station struct {
	DockingBays         []float64     `json:"dockingBays"`
	LocalMovementRadius float64       `json:"localMovementRadius"`
	Mass                float64       `json:"mass"`
	ZIndex              int           `json:"zIndex"`
	HullSegments        []HullSegment `json:"hullSegments"`
}
