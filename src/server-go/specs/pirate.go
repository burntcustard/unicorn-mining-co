package specs

type Pirate struct {
	Names                 []string `json:"names"`
	AttackDelay           float64  `json:"attackDelay"`
	CollectDelay          float64  `json:"collectDelay"`
	DemandDelay           float64  `json:"demandDelay"`
	LootTheftDelay        float64  `json:"lootTheftDelay"`
	ReDemandDelay         float64  `json:"reDemandDelay"`
	CountdownFrom         int      `json:"countdownFrom"`
	CountdownPause        float64  `json:"countdownPause"`
	TauntInterval         float64  `json:"tauntInterval"`
	SearchDuration        float64  `json:"searchDuration"`
	CargoValueThreshold   float64  `json:"cargoValueThreshold"`
	DispatchInterval      float64  `json:"dispatchInterval"`
	EncounterDuration     float64  `json:"encounterDuration"`
	CargoReleaseTimeout   float64  `json:"cargoReleaseTimeout"`
	EncounterCooldown     float64  `json:"encounterCooldown"`
	ReportArrivalDistance float64  `json:"reportArrivalDistance"`
	StartingCredits       float64  `json:"startingCredits"`
	FollowStartDistance   float64  `json:"followStartDistance"`
	FollowDistance        float64  `json:"followDistance"`
	PassDistance          float64  `json:"passDistance"`
	FiringDistance        float64  `json:"firingDistance"`
	AimTolerance          float64  `json:"aimTolerance"`
	AimPredictionTime     float64  `json:"aimPredictionTime"`
}
