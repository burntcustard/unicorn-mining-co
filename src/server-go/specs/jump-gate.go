package specs

type JumpGate struct {
	AccessResponseDelay float64   `json:"accessResponseDelay"`
	Radius              float64   `json:"radius"`
	TravelRadius        float64   `json:"travelRadius"`
	ApproachRadius      float64   `json:"approachRadius"`
	OpeningDuration     float64   `json:"openingDuration"`
	ClosingDuration     float64   `json:"closingDuration"`
	StateHoldDuration   float64   `json:"stateHoldDuration"`
	HalfTravel          float64   `json:"halfTravel"`
	BeamOffsets         []float64 `json:"beamOffsets"`
	BeamInset           float64   `json:"beamInset"`
	CrushDamage         float64   `json:"crushDamage"`
}
