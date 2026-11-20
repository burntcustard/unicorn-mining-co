package specs

type Portal struct {
	PullDuration         float64 `json:"pullDuration"`
	TransitScaleDuration float64 `json:"transitScaleDuration"`
	ArrivalHoldDuration  float64 `json:"arrivalHoldDuration"`
}
