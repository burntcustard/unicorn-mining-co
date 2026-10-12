package specs

type Station struct {
	InitialCargoContents []struct {
		Item  string `json:"item"`
		Count int    `json:"count"`
	} `json:"initialCargoContents"`
	DockingBays         []float64     `json:"dockingBays"`
	LocalMovementRadius float64       `json:"localMovementRadius"`
	Mass                float64       `json:"mass"`
	ZIndex              int           `json:"zIndex"`
	HullSegments        []HullSegment `json:"hullSegments"`
}
