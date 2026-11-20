package specs

type Collector struct {
	Names              []string `json:"names"`
	Ship               string   `json:"ship"`
	OperatingRadius    float64  `json:"operatingRadius"`
	CheckIntervalMin   float64  `json:"checkIntervalMin"`
	CheckIntervalMax   float64  `json:"checkIntervalMax"`
	DiscoveryInterval  float64  `json:"discoveryInterval"`
	MinimumItems       int      `json:"minimumItems"`
	NearbyItemRadius   float64  `json:"nearbyItemRadius"`
	LaunchInterval     float64  `json:"launchInterval"`
	PickupTimeout      float64  `json:"pickupTimeout"`
	ArrivalDistance    float64  `json:"arrivalDistance"`
	InspectionRange    float64  `json:"inspectionRange"`
	InspectionDistance float64  `json:"inspectionDistance"`
	InspectionDelay    float64  `json:"inspectionDelay"`
	InspectionDuration float64  `json:"inspectionDuration"`
}

type CollectorDialog struct {
	Departure     []string `json:"departure"`
	CargoFull     []string `json:"cargoFull"`
	Finished      []string `json:"finished"`
	Damaged       []string `json:"damaged"`
	OutsideRadius []string `json:"outsideRadius"`
	Stranded      []string `json:"stranded"`
	Unreachable   []string `json:"unreachable"`
	Unlisted      []string `json:"unlisted"`
	MissingFirst  []string `json:"missingFirst"`
	MissingSecond []string `json:"missingSecond"`
	MissingThird  []string `json:"missingThird"`
	MissingFourth []string `json:"missingFourth"`
	MissingFifth  []string `json:"missingFifth"`
	MissingSixth  []string `json:"missingSixth"`
}
