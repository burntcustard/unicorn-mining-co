package specs

type NPCMovement struct {
	DecisionInterval  float64 `json:"decisionInterval"`
	ClearanceDistance float64 `json:"clearanceDistance"`
	PredictionTime    float64 `json:"predictionTime"`
	ResponseTime      float64 `json:"responseTime"`
	RouteLookahead    float64 `json:"routeLookahead"`
	ReplanDistance    float64 `json:"replanDistance"`
}
