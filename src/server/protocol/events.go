// Port of src/client/protocol/events.ts.
package protocol

import Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"

type SimulationEvent interface{ simulationEvent() }

type ObjectDestroyed struct {
	ObjectID int64
	Color    string
	Damage   float64
	Position Vec.Vector
}

func (ObjectDestroyed) simulationEvent() {}

type AsteroidSplit struct {
	AsteroidID int64
	ChildIDs   []int64
}

func (AsteroidSplit) simulationEvent() {}

type AsteroidDestroyed struct {
	AsteroidID, By int64
	Contents       []int
}

func (AsteroidDestroyed) simulationEvent() {}

type DrillDamage struct {
	TargetID, By int64
	Damage       float64
	Color        string
	Resource     *int
	Position     Vec.Vector
}

func (DrillDamage) simulationEvent() {}

type CollisionEvent struct {
	A, B     int64
	Impact   float64
	Colors   [2]string
	Damage   [2]float64
	Position Vec.Vector
}

func (CollisionEvent) simulationEvent() {}

type ItemCollected struct {
	By, ItemID int64
	Message    *string
	Resource   int
	Unlock     *string
}

func (ItemCollected) simulationEvent() {}

type Docked struct{ PlayerID, DockedTo int64 }

func (Docked) simulationEvent() {}

type ModuleChanged struct {
	Module   string
	PlayerID int64
	Active   bool
}

func (ModuleChanged) simulationEvent() {}
