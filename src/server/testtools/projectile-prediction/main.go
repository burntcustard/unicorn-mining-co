package main

import (
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// Exercise the real server's hits and staggered binary deltas, rather than
// treating a complete TypeScript world clone as an authoritative snapshot.
func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	cases := []any{}

	for _, scenario := range []struct {
		weapon                        string
		moving, reservesIDs, repeated bool
	}{
		{"autocannon", false, false, false},
		{"autocannon", true, false, false},
		{"plasmaAccelerator", false, false, false},
		{"plasmaAccelerator", false, true, false},
		{"plasmaAccelerator", true, false, false},
		{"plasmaAccelerator", true, true, true},
	} {
		weapon, moving, reservesIDs := scenario.weapon, scenario.moving, scenario.reservesIDs

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
		ship.CargoContents = append(ship.CargoContents, objects.NewItem("autocannonAmmunition", simulation.ObjectProperties{ID: &ammoID, World: world}, catalog))
		rockID := int64(100)
		radius := 50.0
		position := Vec.Create(150, -25)
		ticks := 320

		if scenario.repeated {
			rockID, radius, position, ticks = 3324057349, 70, Vec.Create(160, -25), 800
		}

		contents := []int{}

		if scenario.repeated {
			contents = []int{1, 1, 1}
		}

		rock := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{ID: &rockID, Position: position, Radius: &radius}, Contents: contents})

		if moving {
			rock.Velocity = Vec.Create(0, 1)
			rock.Spin = .01
		}

		simulation.AddEntity(world, rock)
		replication := network.NewBinaryReplicationManager(catalog)
		options := network.SnapshotOptions{World: world, ShipID: id}
		initial := hex.EncodeToString(replication.Initial(options))
		frames := []any{}

		for tick := 0; tick < ticks; tick++ {
			// Objects outside the interest set can consume IDs during local prediction.
			if reservesIDs && tick%5 == 0 {
				simulation.EntityID(world)
			}

			// Match the input boundary used by eight-tick client frames.
			input := protocol.Input{Fire: tick < 304}

			if scenario.repeated {
				// Keep mining the connected remainder after each split.
				largest := rock

				world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
					if asteroid, ok := entity.(*simulation.Asteroid); ok && (largest.Dead || asteroid.Mass > largest.Mass) {
						largest = asteroid
					}
				})

				target := largest.Position

				for _, segment := range largest.Segments() {
					if segment.Health > 1 {
						target = Vec.Add(largest.Position, simulation.RotatePoint(simulation.CenterOf(segment.ShapeOutline), largest.Rotation))
						break
					}
				}

				angle := math.Atan2(target.Y-ship.Position.Y+25, target.X-ship.Position.X) - ship.Rotation
				angle = math.Atan2(math.Sin(angle), math.Cos(angle))
				input.Fire = true

				if math.Abs(angle-ship.Spin*.15) > .005 {
					input.Turn = math.Copysign(1, angle-ship.Spin*.15)
				}
			}

			events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: map[int64]protocol.InputFrame{id: {Input: input}}})
			hits := []any{}
			splits := []int64{}

			for _, event := range events {
				if hit, ok := event.(protocol.CollisionEvent); ok {
					hits = append(hits, map[string]any{"a": hit.A, "b": hit.B, "damage": hit.Damage, "colors": hit.Colors, "position": hit.Position})
				}

				if split, ok := event.(protocol.AsteroidSplit); ok {
					splits = append(splits, split.AsteroidID)
				}
			}

			asteroids := []int64{}
			poses := map[int64]simulation.Pose{}

			world.Entities.ForEach(func(e simulation.Entity, _ int64) {
				if _, ok := e.(*simulation.Asteroid); ok {
					asteroids = append(asteroids, e.Base().ID)
					poses[e.Base().ID] = simulation.Pose{Position: e.Base().Position, Rotation: e.Base().Rotation}
				}
			})

			packet := ""

			if reservesIDs || world.Tick%4 == 0 {
				packet = hex.EncodeToString(replication.Snapshot(options))
			}

			reload := ""

			if scenario.repeated && tick == 240 {
				reload = hex.EncodeToString(network.NewBinaryReplicationManager(catalog).Initial(options))
			}

			frames = append(frames, map[string]any{"input": map[string]any{"fire": input.Fire, "turn": input.Turn}, "reload": reload, "packet": packet, "asteroids": asteroids, "poses": poses, "hits": hits, "splits": splits})
		}

		cases = append(cases, map[string]any{"repeated": scenario.repeated, "reservesIDs": reservesIDs, "weapon": weapon, "moving": moving, "initial": initial, "frames": frames})
	}

	if err := json.NewEncoder(os.Stdout).Encode(cases); err != nil {
		panic(err)
	}
}
