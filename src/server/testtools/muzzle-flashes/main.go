package main

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

/*
 * Exercise firing with real binary snapshots containing authoritative mechanics.
 */
func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	cases := []any{}

	for _, weapon := range []string{"autogun", "plasmaAccelerator"} {
		world := simulation.CreateWorld(25, catalog)
		world.Collisions = gameplay.NewGameCollisions(catalog)
		world.ItemTypes = objects.ItemTypes(catalog)
		id := int64(1)
		ship := objects.CreatePlayerShip(world, objects.Properties{ID: &id, PlayerID: &id})
		simulation.AddEntity(world, ship)
		simulation.AddPlayer(world, simulation.Player{ID: id, ShipID: id})
		gun := modules.Create(weapon, simulation.ObjectProperties{World: world}, catalog)

		for _, mount := range ship.Mounts() {
			if slices.Contains(mount.Fits, weapon) {
				ship.Fit(gun, mount)
				break
			}
		}

		ammoID := simulation.EntityID(world)
		ammo := objects.NewItem("autogunAmmunition", simulation.ObjectProperties{World: world, ID: &ammoID}, catalog)
		ship.CargoContents = append(ship.CargoContents, ammo)
		replication := network.NewBinaryReplicationManager(catalog)
		options := network.SnapshotOptions{World: world, ShipID: id}
		initial := hex.EncodeToString(replication.Initial(options))
		frames := []any{}
		previous := protocol.Input{PlasmaActive: true, AutogunActive: true}

		for tick := 0; tick < 360; tick++ {
			phase := tick % 90
			input := previous
			changes := []protocol.InputChange{}

			if phase < 30 {
				if phase%10 == 0 {
					changes = append(changes, protocol.InputChange{Input: protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, Offset: .004})
				}

				changes = append(changes, protocol.InputChange{Input: protocol.Input{PlasmaActive: true, AutogunActive: true}, Offset: .015})
			} else {
				changes = append(changes, protocol.InputChange{Input: protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: phase < 80}, Offset: .012})
			}

			before := world.NextEntityID
			simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: map[int64]protocol.InputFrame{id: {Input: input, Changes: changes}}})
			previous = changes[len(changes)-1].Input
			edges := []any{}

			// Pairs avoid gameplay tag rewrites of quoted client property names.
			for _, change := range changes {
				edges = append(edges, []any{change.Offset, change.Input.Fire})
			}

			frames = append(frames, map[string]any{"edges": edges, "shots": world.NextEntityID - before, "packet": hex.EncodeToString(replication.Snapshot(options))})
		}

		cases = append(cases, map[string]any{"weapon": weapon, "initial": initial, "frames": frames})
	}

	if err := json.NewEncoder(os.Stdout).Encode(cases); err != nil {
		panic(err)
	}
}
