package npc

import (
	"math/rand/v2"
	"strings"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Player exposes encounter state without coupling NPCs to sockets or accounts.
The identity remains stable when its current ship or connection changes.
*/
type Player interface {
	AccountID() string
	ObserverID() int64
	Ship() *objects.Ship
	Connected() bool
	EncounterAfter() uint64
	SetEncounterAfter(uint64)
}

/*
Environment supplies the active sector and the services owned by the session.
Controllers own their decisions; transport and regional loading stay outside.
*/
type Environment interface {
	World() *simulation.World
	NextObserverID() int64
	Players(func(Player))
	Player(account string) Player
	AllPlayers(func(Player))
	Entity(id int64) simulation.Entity
	Sleeping(func(simulation.Entity, int64))
	SyncRegions()
	Stations(position Vec.Vector, ranges *protocol.WorldRanges) []protocol.StationDescription
	StationID(home protocol.StationDescription) int64
	NearestStation(Vec.Vector) protocol.StationDescription
	SetInput(id int64, input protocol.Input)
	ClearInput(id int64)
	Broadcast(protocol.ServerControl)
	Send(Player, protocol.ServerControl)
}

type SpawnOptions struct {
	DefinitionID, Name string
	Home               protocol.StationDescription
	Credits            *float64
	Hostile            bool
	Configure          func(*objects.Ship)
}

/*
Spawn registers the ordinary ship and its regional observer before launching.
Its cargo, collision, and fuel behavior remain the same as a player's ship.
*/
func Spawn(env Environment, options SpawnOptions) *objects.Ship {
	world := env.World()
	id, observerID := simulation.EntityID(world), env.NextObserverID()
	homeID := env.StationID(options.Home)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: options.DefinitionID, ObjectProperties: simulation.ObjectProperties{World: world, ID: &id, PlayerID: &observerID, Position: options.Home.Position, Name: &options.Name}, DockedTo: &homeID})
	ship.Hostile = options.Hostile

	if options.Configure != nil {
		options.Configure(ship)
	}

	simulation.AddEntity(world, ship)
	Observe(env, ship, options.Credits)
	env.SyncRegions()
	ship.Launch()
	return ship
}

/*
Observe registers a spawned or restored NPC as a regional observer. Its credit
balance also supplies the ordinary station transactions used by player ships.
*/
func Observe(env Environment, ship *objects.Ship, credits *float64) {
	simulation.AddPlayer(env.World(), simulation.Player{ID: *ship.PlayerID, ShipID: ship.ID, Credits: credits, ObserverRange: SightRange})
}

func Remove(env Environment, ship *objects.Ship) {
	env.World().Players.Delete(*ship.PlayerID)
	env.World().Entities.Delete(ship.ID)
	env.ClearInput(*ship.PlayerID)
}

/*
SellCargo uses the ordinary docking transaction. A role can retain its ammunition
by excluding that entity without changing how prices or inventories are updated.
*/
func SellCargo(ship *objects.Ship, credits *float64, exclude simulation.Entity) {
	var ids []int64

	for _, item := range ship.CargoContents {
		if item != exclude {
			ids = append(ids, item.Base().ID)
		}
	}

	if len(ids) > 0 {
		ship.ApplyDockAction(protocol.DockAction{Action: "sell", ObjectIDs: ids}, credits)
	}
}

func Equipment(ship *objects.Ship) (int, int) {
	hull, modules := 0, 0

	for _, segment := range ship.Segments {
		if segment.Hull && segment.Health >= 1 {
			hull++
		}

		for _, mount := range segment.Mounts {
			if mount.Module != nil && mount.Health >= 1 {
				modules++
			}
		}
	}

	return hull, modules
}

/*
DialogText picks once before broadcasting, so every recipient sees the same variant.
Speech uses its own randomness without advancing the simulation's random state.
*/
func DialogText(lines []string, replacements ...string) string {
	if len(lines) == 0 {
		return ""
	}

	return strings.NewReplacer(replacements...).Replace(lines[rand.IntN(len(lines))])
}

func Chat(env Environment, ship *objects.Ship, role string, lines []string, replacements ...string) {
	env.Broadcast(protocol.ServerControl{Type: "chat", Channel: 0, Sender: ship.Name, SenderRole: role, Text: DialogText(lines, replacements...)})
}
