package specs

type JumpGateDialog struct {
	Greeting           []string `json:"greeting"`
	Arrival            []string `json:"arrival"`
	AccessGranted      []string `json:"accessGranted"`
	AccessPending      []string `json:"accessPending"`
	Closing            []string `json:"closing"`
	ClosingInterrupted []string `json:"closingInterrupted"`
	Recovery           []string `json:"recovery"`
}

type PirateDialog struct {
	CargoDemand    []string `json:"cargoDemand"`
	CargoReDemand  []string `json:"cargoReDemand"`
	LootStolen     []string `json:"lootStolen"`
	CargoFull      []string `json:"cargoFull"`
	SuccessfulHaul []string `json:"successfulHaul"`
	Countdown      []string `json:"countdown"`
	CountdownEnd   []string `json:"countdownEnd"`
	Attack         []string `json:"attack"`
	Taunt          []string `json:"taunt"`
	Surrender      []string `json:"surrender"`
	LateSurrender  []string `json:"lateSurrender"`
	BrokenTruce    []string `json:"brokenTruce"`
	DefendLoot     []string `json:"defendLoot"`
	Search         []string `json:"search"`
	LostPlayer     []string `json:"lostPlayer"`
	SearchExpired  []string `json:"searchExpired"`
	Escaped        []string `json:"escaped"`
	Stranded       []string `json:"stranded"`
	Defeat         []string `json:"defeat"`
	Destroyed      []string `json:"destroyed"`
}
