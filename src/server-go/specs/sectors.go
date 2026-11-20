package specs

type DensityFalloff struct {
	Scale, Floor, Cutoff, Peak float64
}

type SectorGeneration struct {
	Version                                                        int
	GraphAnchor                                                    string
	EnabledCount                                                   int
	MapRadiusX, MapRadiusY                                         float64
	GraphStages                                                    []int
	SpareGateSites                                                 int
	SpareWormholeSites                                             int
	MaxConnections                                                 int
	MaxConnectionDistance                                          float64
	GateRadius, WormholeRadius, GateClearance, GateArrivalDistance float64
	GateDistance, GateDistanceRange                                float64
	WormholeDistance, WormholeDistanceRange                        float64
	CruiseSpeed, CrossingMinutes, CrossingMinutesRange             float64
	AspectRatio, AspectRatioRange                                  float64
	RichFieldSearchRange                                           float64
	Density                                                        []DensityFalloff
}
