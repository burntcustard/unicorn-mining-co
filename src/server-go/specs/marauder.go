package specs

type Marauder struct {
	Ship            string  `json:"ship"`
	CheckInterval   float64 `json:"checkInterval"`
	MinimumDistance float64 `json:"minimumDistance"`
	SpawnDistance   float64 `json:"spawnDistance"`
	DespawnDistance float64 `json:"despawnDistance"`
	ArrivalDistance float64 `json:"arrivalDistance"`
	CombatDistance  float64 `json:"combatDistance"`
	CombatDelay     float64 `json:"combatDelay"`
	PassDistance    float64 `json:"passDistance"`
	FiringDistance  float64 `json:"firingDistance"`
	AimTolerance    float64 `json:"aimTolerance"`
}
