package specs

type ShipOffer struct {
	Ship  string  `json:"ship"`
	Price float64 `json:"price"`
}

type Station struct {
	ShipsForSale         []ShipOffer `json:"shipsForSale"`
	Name                 string      `json:"name"`
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
