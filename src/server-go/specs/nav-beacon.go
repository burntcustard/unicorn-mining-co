package specs

type NavBeacon struct {
	Name         string        `json:"name"`
	Mass         float64       `json:"mass"`
	Radius       float64       `json:"radius"`
	HullSegments []HullSegment `json:"hullSegments"`
}
