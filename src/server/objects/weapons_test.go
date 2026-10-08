package objects

import (
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestWeaponRecoil(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, weapon := range []string{"plasmaAccelerator", "autogun"} {
		for _, rotation := range []float64{0, math.Pi / 2, math.Pi} {
			for _, moving := range []bool{false, true} {
				world := simulation.CreateWorld(25, catalog)
				playerID := int64(1)
				ship := CreatePlayerShip(world, Properties{PlayerID: &playerID})
				simulation.AddEntity(world, ship)
				ship.Rotation = rotation

				if moving {
					ship.Velocity = Vec.Create(7, -3)
				}

				gun := modules.Create(weapon, simulation.ObjectProperties{World: world}, catalog)

				for _, mount := range ship.Mounts() {
					if slices.Contains(mount.Fits, weapon) {
						ship.Fit(gun, mount)
						break
					}
				}

				ship.CargoContents = append(ship.CargoContents, NewItem("autogunAmmunition", simulation.ObjectProperties{World: world}, catalog))
				ship.SetModuleActive(weapon, true)
				ship.UpdateModules(3)
				ship.Firing = true
				velocity, start := ship.Velocity, ship.Position
				ship.fireWeapons(0)
				impulse := Vec.Subtract(ship.Velocity, velocity)
				amount := gun.ModuleBase().Spec.Recoil / ship.Mass

				if math.Abs(impulse.X+math.Cos(rotation)*amount) > 1e-9 || math.Abs(impulse.Y+math.Sin(rotation)*amount) > 1e-9 || ship.Spin != 0 {
					t.Fatal("recoil must apply the configured mass-scaled impulse, rotated with the ship, without turning it")
				}

				shots := 0

				world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
					if shot, ok := entity.(*Projectile); ok {
						shots++

						if math.Abs(Vec.Distance(shot.Velocity, velocity)-gun.ModuleBase().Spec.Projectile.Speed) > 1e-9 {
							t.Fatal("the projectile must inherit velocity before recoil")
						}
					}
				})

				if shots != 1 {
					t.Fatal("recoil requires a successful shot")
				}

				after := ship.Velocity
				ship.fireWeapons(.01)

				if ship.Velocity != after {
					t.Fatal("cooldown must not repeatedly apply recoil")
				}

				ship.Update(1.0 / 30)

				if !moving && weapon == "plasmaAccelerator" && (Vec.Distance(start, ship.Position) == 0 || Vec.Dot(Vec.Subtract(ship.Position, start), impulse) <= 0) {
					t.Fatal("a stationary ship must really move backwards on the next update")
				}
			}
		}
	}
}

func TestWeaponBarrelCollisions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, weapon := range []string{"plasmaAccelerator", "autogun"} {
		for _, side := range []float64{-1, 1} {
			world := simulation.CreateWorld(25, catalog)
			mount := simulation.NewMount([]specs.MountPoint{{X: 20, Y: side * 20, Fits: []string{weapon}}})
			plan := &simulation.SegmentPlan{Health: new(100.0), Points: &simulation.ShapeOutline{Points: []simulation.Point{{-2, -2}, {2, -2}, {2, 2}, {-2, 2}}}, Mounts: []*simulation.Mount{mount}}
			craft := NewCraft(Properties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(1)), Radius: new(100.0)}}, []*simulation.SegmentPlan{plan}, catalog)
			simulation.AddEntity(world, craft)
			gun := modules.Create(weapon, simulation.ObjectProperties{World: world}, catalog)
			craft.Fit(gun, mount)
			craft.SetModuleActive(weapon, true)

			for _, segment := range craft.SegmentsAtMount(mount) {
				segment.ActivationProgress = 1
			}

			first := craft.SegmentsAtMount(mount)[0].Outline().Points[0]

			if first[1] != catalog.ModuleSpecs[weapon].Model[0].Points[0][1]*side {
				t.Fatal("ordinary barrel and backing parts must mirror along with recharge indicators")
			}

			atBarrel := Vec.Add(mount.LocalPosition, Vec.Create(15, -1))
			found := false

			for _, collider := range craft.HitboxColliding() {
				segment := collider.Segment.(*simulation.Segment)

				if segment.Module != gun {
					continue
				}

				if collider.Physics == nil || !*collider.Physics || collider.Radius <= 0 {
					t.Fatal("mirrored weapon parts must have physical collision bounds")
				}

				_, touching := query.ContactBetween(query.ShapeData{Position: collider.Position, Rotation: collider.Rotation, Radius: collider.Radius, Outline: collider.ShapeOutline}, query.ShapeData{Position: atBarrel, Radius: 1}, catalog.Simulation.LinearSlop)
				found = found || touching
			}

			if !found {
				t.Fatalf("%s barrel must collide with an object on side %v", weapon, side)
			}

			shot := NewProjectile("autogun", simulation.ObjectProperties{World: world, ID: new(int64(2)), PlayerID: new(int64(2)), Position: Vec.Add(mount.LocalPosition, Vec.Create(60, -1)), Velocity: Vec.Create(-600, 0)}, catalog)
			simulation.AddEntity(world, shot)
			health := mount.Health
			shot.CaptureSweep()
			shot.Update(.1)
			events := []protocol.SimulationEvent{}
			shot.ResolveHits(&events, world, .1)

			if !shot.Dead || mount.Health >= health {
				t.Fatal("projectiles must hit and damage the exposed weapon barrel")
			}
		}
	}
}

func TestWeaponCadenceAndAmmunition(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	playerID := int64(1)
	ship := CreatePlayerShip(world, Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID}})
	simulation.AddEntity(world, ship)
	plasma := modules.Create("plasmaAccelerator", simulation.ObjectProperties{World: world}, catalog)
	auto := modules.Create("autogun", simulation.ObjectProperties{World: world}, catalog)

	for _, mount := range ship.Mounts() {
		for _, id := range mount.Fits {
			if id == "plasmaAccelerator" && plasma.ModuleBase().Mount == nil {
				ship.Fit(plasma, mount)
				break
			}

			if id == "autogun" && auto.ModuleBase().Mount == nil && mount.Module != plasma {
				ship.Fit(auto, mount)
				break
			}
		}
	}

	if plasma.ModuleBase().Mount == nil || auto.ModuleBase().Mount == nil {
		t.Fatal("weapons must fit current ships")
	}

	ship.CargoContents = append(ship.CargoContents, NewItem("gold", simulation.ObjectProperties{World: world}, catalog))

	pack := NewItem("autogunAmmunition", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = append(ship.CargoContents, pack)
	cargoCount := len(ship.CargoContents)
	ammoIndex := cargoCount - 1

	if pack.Rounds == nil || *pack.Rounds != 200 {
		t.Fatal("a new ammunition pack must contain 200 rounds")
	}

	events := []protocol.SimulationEvent{}
	ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
	ship.SetModuleActive("autogun", false)
	ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)

	if !ship.ModuleActive("plasmaAccelerator") || !ship.ModuleActive("autogun") {
		t.Fatal("the weapon toggle must synchronize weapons with different activation states")
	}

	ship.UpdateModules(3)
	ship.fireWeapons(0)

	for range 119 {
		ship.fireWeapons(1.0 / 120)
	}

	counts := map[string]int{}

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if shot, ok := entity.(*Projectile); ok {
			counts[shot.DefinitionID]++

			// TestWeaponRecoil checks speed against velocity at firing time;
			// later shots can change the ship's velocity through recoil.
			spec := catalog.ModuleSpecs[shot.DefinitionID]

			if shot.Radius != spec.Projectile.Radius || shot.Health != spec.Damage {
				t.Fatalf("%s projectile: radius %v (want %v), health %v (want %v)", shot.DefinitionID, shot.Radius, spec.Projectile.Radius, shot.Health, spec.Damage)
			}
		}
	})

	if counts["plasmaAccelerator"] != 1 || counts["autogun"] != 4 {
		t.Fatalf("want 1 plasma and 4 autogun shots, got %v", counts)
	}

	ammo, gold := 0, 0

	for _, item := range ship.CargoContents {
		if item.Base().HasResource && item.Base().Resource == 5 {
			ammo++
		}

		if item.Base().HasResource && item.Base().Resource == 2 {
			gold++
		}
	}

	if ammo != 1 || *pack.Rounds != 196 || gold != 1 {
		t.Fatal("each shot must consume one round, keeping the pack and leaving ore")
	}

	compact, err := RestoreShip(CaptureShip(ship), world, playerID)

	if err != nil {
		t.Fatal(err)
	}

	if *compact.CargoContents[ammoIndex].(*Item).Rounds != 196 {
		t.Fatal("player profile must preserve rounds in partially used packs")
	}

	for _, module := range compact.Modules() {
		if module.ModuleBase().Type == "plasmaAccelerator" && math.Abs(module.ModuleBase().FireCooldown-plasma.ModuleBase().FireCooldown) > 1e-12 {
			t.Fatal("player profile must preserve firing cooldown")
		}
	}

	saved := CaptureEntity(ship)
	restored, err := RestoreEntity(saved, world)

	if err != nil {
		t.Fatal(err)
	}

	if *restored.(*Ship).CargoContents[ammoIndex].(*Item).Rounds != 196 {
		t.Fatal("world save must preserve rounds in partially used packs")
	}

	for _, module := range restored.(*Ship).Modules() {
		if module.ModuleBase().Type == "plasmaAccelerator" && math.Abs(module.ModuleBase().FireCooldown-plasma.ModuleBase().FireCooldown) > 1e-12 {
			t.Fatal("saved weapon cooldown changed")
		}
	}

	for range 196 {
		ship.fireWeapons(.25)
	}

	if len(ship.CargoContents) != cargoCount-1 || *pack.Rounds != 0 {
		t.Fatal("the pack must be removed after its 200th shot")
	}

	ship.fireWeapons(.25)
	autoCount := 0

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if entity.Base().DefinitionID == "autogun" {
			autoCount++
		}
	})

	if autoCount != 200 {
		t.Fatal("one pack must fire exactly 200 shots and then stop")
	}

	if *compact.CargoContents[ammoIndex].(*Item).Rounds != 196 || *restored.(*Ship).CargoContents[ammoIndex].(*Item).Rounds != 196 || *saved.CargoContents[ammoIndex].Rounds != 196 {
		t.Fatal("restored and saved packs must own their round counters")
	}

	lastRound := NewItem("autogunAmmunition", simulation.ObjectProperties{World: world}, catalog)
	*lastRound.Rounds = 1
	nextPack := NewItem("autogunAmmunition", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = append(ship.CargoContents, lastRound, nextPack)
	ship.UpdateModules(3)
	ship.fireWeapons(0)
	ship.fireWeapons(.25)

	if len(ship.CargoContents) != cargoCount || ship.CargoContents[len(ship.CargoContents)-1] != nextPack || *nextPack.Rounds != 199 {
		t.Fatal("firing must continue into the next pack")
	}

	before := world.Entities.Len()
	ship.Control(protocol.Input{}, &events)
	ship.fireWeapons(1)

	if world.Entities.Len() != before {
		t.Fatal("releasing Space must stop firing")
	}

	ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
	stationID := int64(99)
	ship.DockedTo = &stationID
	ship.fireWeapons(1)

	if world.Entities.Len() != before {
		t.Fatal("docked weapons must not fire")
	}
}

func TestPlasmaRecharge(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	playerID := int64(1)
	ship := CreatePlayerShip(world, Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID}})
	gun := modules.Create("plasmaAccelerator", simulation.ObjectProperties{World: world}, catalog)

	for _, mount := range ship.Mounts() {
		for _, id := range mount.Fits {
			if id == "plasmaAccelerator" {
				ship.Fit(gun, mount)
				break
			}
		}

		if gun.ModuleBase().Mount != nil {
			break
		}
	}

	ship.SetModuleActive("plasmaAccelerator", true)
	ship.UpdateModules(3)

	for _, side := range []float64{-1, 1} {
		gun.ModuleBase().Mount.LocalPosition.Y = side * 29

		for _, segment := range ship.SegmentsAtMount(gun.ModuleBase().Mount) {
			outline := segment.Outline().Points

			if segment.Color == catalog.Colors["violet"][0] {
				if len(outline) != 4 || outline[0][0] != 0 || outline[2][0] != gun.ModuleBase().Spec.BarrelLength {
					t.Fatal("the dark backing must span the entire weapon")
				}
			} else if len(outline) == 8 {
				if outline[4][1] != .5*side || outline[5][1] != .5*side {
					t.Fatal("the barrel cutout must face away from the ship centre")
				}
			} else {
				for _, point := range outline {
					if point[0] < 1 || point[0] >= 12 || point[1]*side <= .5 || point[1]*side > 3 {
						t.Fatal("recharge rectangles must remain inside the cutout")
					}
				}
			}
		}
	}

	events := []protocol.SimulationEvent{}
	ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
	ship.UpdateModules(3)
	ship.fireWeapons(0)
	initial := world.Entities.Len()

	interval := gun.ModuleBase().Spec.FireInterval
	ship.fireWeapons(interval - .001)

	if world.Entities.Len() != initial {
		t.Fatal("plasma must wait for the configured cooldown before firing again")
	}

	ship.fireWeapons(.001)

	if world.Entities.Len() != initial+1 || math.Abs(gun.ModuleBase().FireCooldown-interval) > 1e-9 {
		t.Fatal("holding fire must produce the next plasma shot at the cooldown boundary")
	}
}

func TestProjectileChunkDamage(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"plasmaAccelerator", "autogun"} {
		for _, maxHealth := range []float64{31, 71} {
			for _, previousDamage := range []float64{0, 10.5} {
				t.Run(id, func(t *testing.T) {
					world := simulation.CreateWorld(25, catalog)
					outline := &simulation.ShapeOutline{Points: []simulation.Point{{-10, -10}, {10, -10}, {10, 10}, {-10, 10}}}
					asteroidID, playerID := int64(200), int64(1)
					radius, health, mass := 15.0, 100.0, 10.0
					asteroid := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: &asteroidID, Radius: &radius, Health: &health, Mass: &mass, ShapeOutline: outline}, Contents: []int{}, Segments: []*simulation.AsteroidSegment{{Contents: []int{}, Health: maxHealth, MaxHealth: maxHealth, Mass: mass, ShapeOutline: outline}}}, world)
					simulation.AddEntity(world, asteroid)
					Damage(asteroid.Segments()[0], previousDamage)
					amount := catalog.ModuleSpecs[id].Damage
					count := int(math.Floor((asteroid.Segments()[0].Health-1)/amount)) + 1
					events := []protocol.SimulationEvent{}

					for n := 1; n <= count; n++ {
						asteroid.Velocity = Vec.Vector{}
						asteroid.Spin = 0
						beforeEvents := len(events)
						shotID := int64(300 + n)
						shot := NewProjectile(id, simulation.ObjectProperties{World: world, ID: &shotID, PlayerID: &playerID, Position: Vec.Create(-80, 0), Velocity: Vec.Create(600, 0)}, catalog)
						simulation.AddEntity(world, shot)
						shot.CaptureSweep()
						shot.Update(.3)
						shot.ResolveHits(&events, world, .3)

						if !shot.Dead {
							t.Fatal("projectile tunnelled through asteroid")
						}

						hit, ok := events[beforeEvents].(protocol.CollisionEvent)

						if !ok || hit.A != shotID || hit.B != asteroidID || hit.Damage[0] != amount || hit.Damage[1] != amount {
							t.Fatal("projectile damage must be fixed regardless of segment strength or earlier damage")
						}

						if hit.Position.X <= -15 || hit.Position.X >= -9 || math.Abs(hit.Position.Y) > 1e-6 || hit.Colors[1] != catalog.Colors["white"][2] {
							t.Fatal("hit effects must use the swept contact position and struck surface colour")
						}

						split := false

						for _, event := range events {
							if _, ok := event.(protocol.AsteroidSplit); ok {
								split = true
							}
						}

						if split != (n == count) {
							t.Fatalf("want split on shot %v, got split=%v after shot %v", count, split, n)
						}
					}
				})
			}
		}
	}
}

func TestBuyAutogunAmmo(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{})
	credits := 4.0
	_, ok := ship.ApplyDockAction(protocol.DockAction{Action: "buyAmmo"}, &credits)

	if !ok || credits != 2 || ship.CargoContents[len(ship.CargoContents)-1].Base().ID < 1 || ship.CargoContents[len(ship.CargoContents)-1].Base().Resource != 5 || *ship.CargoContents[len(ship.CargoContents)-1].(*Item).Rounds != 200 {
		t.Fatal("ammo purchase must allocate an entity ID and charge its price")
	}

	credits = 1

	if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "buyAmmo"}, &credits); ok {
		t.Fatal("unaffordable ammo purchase succeeded")
	}

	credits = 4

	for len(ship.CargoContents) < ship.CargoSpace {
		ship.CargoContents = append(ship.CargoContents, NewItem("gold", simulation.ObjectProperties{World: world}, catalog))
	}

	if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "buyAmmo"}, &credits); ok || credits != 4 {
		t.Fatal("full cargo must reject ammo purchase")
	}
}

func TestProjectileHitsNearestCircleAndIgnoresOwner(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	player, other := int64(1), int64(2)
	friendly := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(1)), PlayerID: &player, Health: new(100.), Radius: new(5.), Position: Vec.Create(-10, 0)}, catalog.Simulation)
	far := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(2)), PlayerID: &other, Health: new(100.), Radius: new(5.), Position: Vec.Create(40, 0)}, catalog.Simulation)
	near := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(3)), PlayerID: &other, Health: new(100.), Radius: new(5.), Position: Vec.Create(20, 0)}, catalog.Simulation)
	simulation.AddEntity(world, friendly)
	simulation.AddEntity(world, far)
	simulation.AddEntity(world, near)
	shot := NewProjectile("autogun", simulation.ObjectProperties{World: world, ID: new(int64(4)), PlayerID: &player, Position: Vec.Create(-80, 0), Velocity: Vec.Create(600, 0)}, catalog)
	simulation.AddEntity(world, shot)
	shot.Update(.3)
	events := []protocol.SimulationEvent{}
	shot.ResolveHits(&events, world, 1.0/30)

	if !shot.Dead || friendly.Health != 100 || near.Health != 96 || far.Health != 100 {
		t.Fatalf("want one nearest hit and owner immunity; dead=%v, health=%v/%v/%v", shot.Dead, friendly.Health, near.Health, far.Health)
	}
}

func TestProjectileHitsDetachedAsteroid(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	outline := &simulation.ShapeOutline{Points: []simulation.Point{{-10, -10}, {10, -10}, {10, 10}, {-10, 10}}}
	target := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(1)), Health: new(20.), Radius: new(15.), ShapeOutline: outline}, Contents: []int{}}, world)
	simulation.AddEntity(world, target)
	shot := NewProjectile("plasmaAccelerator", simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: Vec.Create(-80, 0), Velocity: Vec.Create(600, 0)}, catalog)
	shot.Update(.3)
	events := []protocol.SimulationEvent{}
	shot.ResolveHits(&events, world, .3)

	if !shot.Dead || target.Health != 10 {
		t.Fatal("a detached chunk must take damage directly, without an asteroid segment")
	}
}

func TestProjectileHitsMovedCachedAsteroid(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, rotated := range []bool{false, true} {
		t.Run(map[bool]string{false: "translated", true: "rotated"}[rotated], func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			outline := &simulation.ShapeOutline{Points: []simulation.Point{{-20, -3}, {20, -3}, {20, 3}, {-20, 3}}}
			target := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(1)), Health: new(20.), Radius: new(21.), ShapeOutline: outline}, Contents: []int{}}, world)
			simulation.AddEntity(world, target)
			target.LockGeometry()
			target.Hitbox()
			shotY := 50.0
			target.Position = Vec.Create(100, 50)

			if rotated {
				target.Position = Vec.Vector{}
				target.Rotation = math.Pi / 2
				shotY = 12
			}

			shot := NewProjectile("plasmaAccelerator", simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: Vec.Create(target.Position.X-60, shotY), Velocity: Vec.Create(600, 0)}, catalog)
			shot.CaptureSweep()
			shot.Update(.2)
			events := []protocol.SimulationEvent{}
			shot.ResolveHits(&events, world, .2)

			if !shot.Dead || target.Health != 10 || len(events) != 1 {
				t.Fatal("projectiles must hit the current pose of an asteroid with cached colliders")
			}
		})
	}
}

func TestProjectileExpirySparks(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"autogun", "plasmaAccelerator"} {
		world := simulation.CreateWorld(25, catalog)
		shot := NewProjectile(id, simulation.ObjectProperties{World: world, ID: new(int64(1)), Health: new(.001), Position: Vec.Create(5, 6)}, catalog)
		simulation.AddEntity(world, shot)
		neighbour := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: Vec.Create(10, 6), Mass: new(1.0)}, catalog.Simulation)
		simulation.AddEntity(world, neighbour)
		events := []protocol.SimulationEvent{}
		simulation.UpdateEntities(world, simulation.UpdateEntitiesOptions{Events: &events, Tick: new(uint64(7))})

		expectedEvents := 1

		if shot.Spec.Projectile.FadeOut > 0 {
			expectedEvents = 0
		}

		if !shot.Dead || len(events) != expectedEvents {
			t.Fatal("fading expiry must be silent; other projectiles emit one death event")
		}

		if expectedEvents > 0 {
			event, ok := events[0].(protocol.ObjectDestroyed)

			if !ok || event.ObjectID != shot.ID || event.Color != catalog.ModuleSpecs[id].Projectile.Color || event.Damage != catalog.ModuleSpecs[id].Damage || event.Position != shot.Position {
				t.Fatal("expiry sparks must retain the projectile's colour and location")
			}
		}

		if id == "autogun" && Vec.Length(neighbour.Velocity) != 0 || id == "plasmaAccelerator" && neighbour.Velocity.X <= 0 {
			t.Fatal("only plasma expiry must push nearby objects")
		}

		events = nil
		simulation.UpdateEntities(world, simulation.UpdateEntitiesOptions{Events: &events, Tick: new(uint64(8))})

		if len(events) != 0 {
			t.Fatal("removed projectiles must not repeat their death event")
		}
	}
}

func TestExplosionFromGameObject(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	source := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(1))}, catalog.Simulation)
	neighbour := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: Vec.Create(10, 0), Mass: new(1.0), Health: new(100.0)}, catalog.Simulation)
	simulation.AddEntity(world, source)
	simulation.AddEntity(world, neighbour)
	Explode(ExplosionOptions{Object: source, Radius: 20, Impulse: 8})

	if neighbour.Velocity.X != 4 || neighbour.Health != 100 {
		t.Fatal("ordinary game objects must be able to use the shared impulse without splash damage")
	}

	if Vec.Length(source.Velocity) != 0 || source.Dead {
		t.Fatal("the shared explosion must not push or destroy its own source")
	}

	spin := neighbour.Spin

	if spin == 0 || math.Abs(spin) > 3 || neighbour.Rotation != 0 || source.Spin != 0 {
		t.Fatal("blast must add bounded spin without snapping rotation or spinning its source")
	}

	neighbour.Spin = 0.7
	Explode(ExplosionOptions{Object: source, Radius: 20, Impulse: 8})

	if math.Abs(neighbour.Spin-0.7-spin) > 1e-12 {
		t.Fatal("blast spin must be seeded and additive")
	}

	neighbour.Spin = 0
	neighbour.Position.X = 15
	Explode(ExplosionOptions{Object: source, Radius: 20, Impulse: 8})

	if neighbour.Spin != spin/2 {
		t.Fatal("blast spin must fade with distance")
	}

	for _, maxSpeed := range []float64{0.1, 24} {
		var spins [3]float64

		for i, mass := range []float64{3, 30, 300} {
			neighbour.Mass, neighbour.Radius, neighbour.Spin = mass, 8, 0
			Explode(ExplosionOptions{Object: source, Radius: 20, Impulse: 2400, MaxSpeed: maxSpeed})
			spins[i] = neighbour.Spin
		}

		if math.Abs(spins[0]) <= 0.65 || math.Abs(spins[0]) > 1.3 {
			t.Fatal("light items should spin more than the old one-radian cap at this falloff")
		}

		if math.Abs(spins[1]*10-spins[0]) > 1e-12 || math.Abs(spins[2]*100-spins[0]) > 1e-12 {
			t.Fatal("spin must scale inversely with mass even when linear speed is capped")
		}
	}
}

func TestProjectileExplosion(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"plasmaAccelerator", "autogun"} {
		for _, trigger := range []string{"hit", "expiry", "cleanup"} {
			t.Run(id+"/"+trigger, func(t *testing.T) {
				world := simulation.CreateWorld(25, catalog)

				object := func(id int64, position Vec.Vector, mass float64) *simulation.GameObject {
					o := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: &id, Position: position, Radius: new(1.0), Mass: &mass, Health: new(100.0)}, catalog.Simulation)
					simulation.AddEntity(world, o)
					return o
				}

				target := object(1, Vec.Create(20, 0), 3)
				target.Radius = 5
				light := object(2, Vec.Create(13, 10), 1)
				heavy := object(3, Vec.Create(13, 10), 1000)
				below := object(4, Vec.Create(13, -10), 1)
				far := object(5, Vec.Create(13, 50), 1)
				buried := object(6, Vec.Create(13, -8), 1)
				buried.Buried = true
				otherShot := NewProjectile(id, simulation.ObjectProperties{World: world, ID: new(int64(7)), Position: Vec.Create(13, 12)}, catalog)
				simulation.AddEntity(world, otherShot)
				position, velocity := Vec.Create(13, 0), Vec.Vector{}

				if trigger == "hit" {
					position, velocity = Vec.Create(-80, 0), Vec.Create(600, 0)
				}

				shot := NewProjectile(id, simulation.ObjectProperties{World: world, ID: new(int64(8)), Position: position, Velocity: velocity}, catalog)
				simulation.AddEntity(world, shot)
				spec := catalog.ModuleSpecs[id]

				if shot.Health != spec.Damage {
					t.Fatal("projectile health must start at weapon damage")
				}

				events := []protocol.SimulationEvent{}

				switch trigger {
				case "hit":
					shot.Update(.3)
					shot.ResolveHits(&events, world, .3)

					if target.Health != 100-spec.Damage {
						t.Fatal("the hit must damage its target")
					}
				case "expiry":
					shot.Update(spec.Projectile.Lifetime - .001)

					if shot.Dead {
						t.Fatal("projectiles must retain their configured lifespan")
					}

					simulation.UpdateEntities(world, simulation.UpdateEntitiesOptions{Entities: []simulation.Entity{shot}, Events: &events, DT: new(.002), Tick: new(uint64(7))})
					expected := 100.0

					if spec.Projectile.Explosion != nil {
						expected -= spec.Projectile.Explosion.Damage
					}

					if target.Health != expected {
						t.Fatal("only plasma expiry must damage nearby objects")
					}
				case "cleanup":
					shot.Remove()
				}

				if !shot.Dead || world.Entities.Has(shot.ID) {
					t.Fatal("death must remove the projectile from the world")
				}

				if trigger == "cleanup" || spec.Projectile.Explosion == nil {
					if Vec.Length(light.Velocity) != 0 || Vec.Length(below.Velocity) != 0 || Vec.Length(otherShot.Velocity) != 0 {
						t.Fatal("simple projectiles and replication cleanup must not push nearby objects")
					}

					if light.Health != 100 {
						t.Fatal("autogun and cleanup must not deal splash damage")
					}

					return
				}

				if light.Velocity.Y <= 0 || below.Velocity.Y >= 0 || otherShot.Velocity.Y <= 0 {
					t.Fatal("the explosion must push unhit objects radially, including other projectiles")
				}

				if light.Velocity.Y <= heavy.Velocity.Y || heavy.Velocity.Y <= 0 || Vec.Length(light.Velocity) > spec.Projectile.Explosion.MaxSpeed {
					t.Fatal("massive fragments must receive a smaller push, while light objects respect the speed cap")
				}

				if light.Health != 100-spec.Projectile.Explosion.Damage || heavy.Health != light.Health || below.Health != light.Health || far.Health != 100 || buried.Health != 100 || Vec.Length(far.Velocity) != 0 || Vec.Length(buried.Velocity) != 0 {
					t.Fatal("plasma must damage nearby surfaces, regardless of mass, and leave distant or buried objects alone")
				}

				before := light.Velocity
				shot.ResolveHits(&events, world, .3)
				shot.Update(.1)

				if light.Velocity != before {
					t.Fatal("a dead projectile must not explode again")
				}
			})
		}
	}
}

func TestProjectileExplosionPushesReleasedItems(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	world.ItemTypes = ItemTypes(catalog)
	outline := &simulation.ShapeOutline{Points: []simulation.Point{{-10, -10}, {10, -10}, {10, 10}, {-10, 10}}}
	asteroid := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(1)), Health: new(5.0), Radius: new(15.0), Mass: new(10.0), ShapeOutline: outline}, Contents: []int{2}}, world)
	simulation.AddEntity(world, asteroid)
	shot := NewProjectile("plasmaAccelerator", simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: Vec.Create(-80, 0), Velocity: Vec.Create(600, 0)}, catalog)
	simulation.AddEntity(world, shot)
	shot.Update(.3)
	events := []protocol.SimulationEvent{}
	shot.ResolveHits(&events, world, .3)
	found := false

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if item, ok := entity.(*Item); ok {
			found = true

			if item.Velocity.X <= 0 {
				t.Fatal("resources created by the hit must be pushed by the same explosion")
			}
		}
	})

	if !asteroid.Dead || !found {
		t.Fatal("destroying the asteroid must release its resource")
	}
}

func TestExplosionDamagesNearbySegments(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	source := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(1)), Velocity: Vec.Create(1, 0)}, catalog.Simulation)
	simulation.AddEntity(world, source)
	segments := []*simulation.AsteroidSegment{}

	for _, x := range []float64{-10, 10, 50} {
		segments = append(segments, &simulation.AsteroidSegment{Contents: []int{}, Health: 5, MaxHealth: 20, Mass: 10, ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{x, -10}, {x + 20, -10}, {x + 20, 10}, {x, 10}}}})
	}

	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(2)), Health: new(100.0), Radius: new(80.0), Mass: new(30.0)}, Contents: []int{}, MaxHealth: new(100.0), Segments: segments}, world)
	simulation.AddEntity(world, rock)
	events := []protocol.SimulationEvent{}
	Explode(ExplosionOptions{Object: source, Radius: 24, Impulse: 12, Damage: 10, Events: &events})

	if !rock.Dead {
		t.Fatal("blast must split damaged asteroid")
	}

	for i, expected := range []float64{-5, -5, 5} {
		if rock.Segments()[i].Health != expected {
			t.Fatal("damage must follow segment polygons, not the whole asteroid bounding circle")
		}
	}

	children, splits, hits := 0, 0, 0

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if child, ok := entity.(*simulation.Asteroid); ok {
			children++

			if child.Health <= 0 {
				t.Fatal("new fragments must not receive a second damage pass")
			}

			for _, segment := range child.Segments() {
				if segment.Health < 1 {
					t.Fatal("all broken segments must detach")
				}
			}

			if child.Position.X < 30 && Vec.Length(child.Velocity) == 0 {
				t.Fatal("nearby new fragments must receive the push")
			}
		}
	})

	for _, event := range events {
		switch event.(type) {
		case protocol.AsteroidSplit:
			splits++
		case protocol.CollisionEvent:
			hits++
		}
	}

	if children != 3 || splits != 1 || hits != 2 {
		t.Fatalf("want three chunks, one split and two damaged surfaces; got %d/%d/%d", children, splits, hits)
	}
}

func TestPlasmaPushSurvivesMovement(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"plasmaAccelerator", "autogun"} {
		world := simulation.CreateWorld(25, catalog)
		item := NewItem("gold", simulation.ObjectProperties{World: world, ID: new(int64(1)), Position: Vec.Create(15, 18)}, catalog)
		simulation.AddEntity(world, item)
		targets := []simulation.Entity{item}

		for index, mass := range []float64{62.5, 300} {
			y := 15.0

			if index == 1 {
				y = -15
			}

			rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(index + 2)), Radius: new(10.0), Mass: &mass, Health: new(100.0), Position: Vec.Create(15, y), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-8, -8}, {8, -8}, {8, 8}, {-8, 8}}}}, Contents: []int{}, MaxHealth: new(100.0)}, world)
			simulation.AddEntity(world, rock)
			targets = append(targets, rock)
		}

		starts := []Vec.Vector{}

		for _, target := range targets {
			starts = append(starts, target.Base().Position)
		}

		shot := NewProjectile(id, simulation.ObjectProperties{World: world, ID: new(int64(4)), Health: new(.001)}, catalog)
		simulation.AddEntity(world, shot)
		simulation.UpdateEntities(world, simulation.UpdateEntitiesOptions{Entities: []simulation.Entity{shot}, Tick: new(uint64(7))})

		if !shot.Dead {
			t.Fatal("projectile must expire")
		}

		for index, target := range targets {
			if explosion := catalog.ModuleSpecs[id].Projectile.Explosion; explosion != nil && Vec.Length(target.Base().Velocity) > explosion.MaxSpeed {
				t.Fatal("blast must cap the added speed of light objects")
			}

			for range 30 {
				target.Update(1.0 / 30)
			}

			offset := Vec.Subtract(target.Base().Position, starts[index])

			if id == "plasmaAccelerator" {
				if Vec.Length(offset) <= 1 || Vec.Dot(offset, starts[index]) <= 0 {
					t.Fatal("items and small asteroid chunks must keep moving away from the plasma blast")
				}
			} else if Vec.Length(offset) != 0 {
				t.Fatal("autogun expiry must not push nearby objects")
			}
		}
	}
}

func TestExplosionDamagesModuleOnce(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	source := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(1)), Position: Vec.Create(30, 20)}, catalog.Simulation)
	simulation.AddEntity(world, source)
	mount := simulation.NewMount([]specs.MountPoint{{X: 20, Y: 20, Fits: []string{"plasmaAccelerator"}}})
	plan := &simulation.SegmentPlan{Health: new(100.0), Points: &simulation.ShapeOutline{Points: []simulation.Point{{-2, -2}, {2, -2}, {2, 2}, {-2, 2}}}, Mounts: []*simulation.Mount{mount}}
	craft := NewCraft(Properties{ObjectProperties: simulation.ObjectProperties{World: world, ID: new(int64(2)), Radius: new(100.0)}}, []*simulation.SegmentPlan{plan}, catalog)
	simulation.AddEntity(world, craft)
	gun := modules.Create("plasmaAccelerator", simulation.ObjectProperties{World: world}, catalog)
	craft.Fit(gun, mount)
	craft.SetModuleActive("plasmaAccelerator", true)
	events := []protocol.SimulationEvent{}
	Explode(ExplosionOptions{Object: source, Radius: 24, Damage: 3, Events: &events})

	if mount.Health != *gun.ModuleBase().Spec.HealthActivated-3 {
		t.Fatal("overlapping parts must damage the module mount only once")
	}

	for _, segment := range craft.Segments {
		if segment.Hull && segment.Health != 100 {
			t.Fatal("a distant hull must not take damage from a nearby bounding circle")
		}
	}

	if len(events) != 1 {
		t.Fatal("one damaged mount must produce one spark event")
	}

	shot := NewProjectile("plasmaAccelerator", simulation.ObjectProperties{World: world, ID: new(int64(3)), Position: Vec.Create(80, 19), Velocity: Vec.Create(-600, 0)}, catalog)
	simulation.AddEntity(world, shot)
	health := mount.Health
	shot.Update(.1)
	shot.ResolveHits(&events, world, .1)

	if !shot.Dead || mount.Health != health-shot.Spec.Damage {
		t.Fatal("the direct plasma hit must exclude the whole fitted module from repeated splash damage")
	}
}

func TestWeaponDeployment(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"plasmaAccelerator", "autogun"} {
		t.Run(id, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := CreatePlayerShip(world, Properties{PlayerID: new(int64(1))})
			simulation.AddEntity(world, ship)
			gun := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)

			for _, mount := range ship.Mounts() {
				if slices.Contains(mount.Fits, id) {
					ship.Fit(gun, mount)
					break
				}
			}

			pack := NewItem("autogunAmmunition", simulation.ObjectProperties{World: world}, catalog)
			ship.CargoContents = append(ship.CargoContents, pack)
			part := ship.SegmentsAtMount(gun.ModuleBase().Mount)[0]
			spec := gun.ModuleBase().Spec
			x := spec.Model[0].Points[0][0]

			if part.Outline().Points[0][0] != x-spec.RetractionDistance {
				t.Fatal("inactive weapon must use the shorter retraction distance")
			}

			events := []protocol.SimulationEvent{}
			ship.Control(protocol.Input{Fire: true}, &events)
			ship.fireWeapons(0)

			if world.Entities.Len() != 1 || part.Active != 0 {
				t.Fatal("Space must not deploy or fire an inactive weapon")
			}

			ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
			ship.UpdateModules(spec.ActivationDuration / 2)

			if part.ActivationProgress != .5 || part.Outline().Points[0][0] != x-spec.RetractionDistance/2 {
				t.Fatal("weapon must slide smoothly during activation")
			}

			ship.fireWeapons(1)

			if world.Entities.Len() != 1 || *pack.Rounds != 200 {
				t.Fatal("activation must not fire or consume ammunition")
			}

			health := gun.ModuleBase().Mount.Health

			if Damage(part, 1) != 1 || gun.ModuleBase().Mount.Health != health-1 {
				t.Fatal("active weapons must take damage")
			}

			ship.Control(protocol.Input{Fire: true}, &events)
			ship.UpdateModules(spec.ActivationDuration / 4)

			ratio := 1.0

			if spec.DischargeDuration > 0 {
				ratio += spec.DischargeDuration / spec.ActivationDuration
			}

			if math.Abs(part.ActivationProgress-.25/ratio) > 1e-9 {
				t.Fatal("reversal must continue from current deployment progress")
			}

			ship.fireWeapons(0)

			if world.Entities.Len() != 1 {
				t.Fatal("retraction must block firing")
			}

			if Damage(part, 1) != 0 {
				t.Fatal("inactive weapons must be invulnerable")
			}

			ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
			ship.UpdateModules(spec.ActivationDuration*.75 + 1e-9)

			if part.ActivationProgress != 1 || part.Outline().Points[0][0] != x {
				t.Fatal("complete activation must restore authored geometry")
			}

			ship.fireWeapons(0)

			if world.Entities.Len() != 1 || math.Abs(gun.ModuleBase().ChargeCooldown-spec.ChargeDuration) > 1e-8 {
				t.Fatal("deployment must finish before charging begins")
			}

			ship.UpdateModules(spec.ChargeDuration / 2)
			ship.fireWeapons(0)

			if world.Entities.Len() != 1 {
				t.Fatal("charging must block firing")
			}

			saved := ship.ModuleStates()
			ship.Control(protocol.Input{Fire: true}, &events)
			ship.UpdateModules(.01)

			if gun.ModuleBase().ChargeCooldown != spec.ChargeDuration {
				t.Fatal("retraction must reset charging")
			}

			ship.SetModuleStates(saved)
			gun = ship.Modules()[0]

			for _, fitted := range ship.Modules() {
				if fitted.ModuleBase().Type == id {
					gun = fitted
					break
				}
			}

			part = ship.SegmentsAtMount(gun.ModuleBase().Mount)[0]
			ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true, Fire: true}, &events)
			ship.UpdateModules(spec.ChargeDuration/2 - .001)
			ship.fireWeapons(0)

			if world.Entities.Len() != 1 {
				t.Fatal("charge boundary must block early fire")
			}

			ship.UpdateModules(.001)
			ship.fireWeapons(0)

			if world.Entities.Len() != 2 {
				t.Fatal("full deployment and charge must allow firing")
			}

			ship.Control(protocol.Input{PlasmaActive: true, AutogunActive: true}, &events)
			ship.fireWeapons(spec.FireInterval)

			if world.Entities.Len() != 2 || part.Active != 1 {
				t.Fatal("releasing Space must stop firing and retain deployment")
			}

			ship.Control(protocol.Input{Fire: true}, &events)
			ship.fireWeapons(0)

			if world.Entities.Len() != 2 {
				t.Fatal("deactivation must block firing immediately")
			}

			shutdown := spec.ActivationDuration

			if spec.DischargeDuration > 0 {
				shutdown += spec.DischargeDuration
			}

			if spec.DischargeDuration > 0 {
				ship.UpdateModules(shutdown - spec.ActivationDuration)

				if part.Outline().Points[0][0] != x {
					t.Fatal("barrels must remain extended throughout spin-down")
				}

				ship.UpdateModules(spec.ActivationDuration / 2)

				if math.Abs(part.Outline().Points[0][0]-(x-spec.RetractionDistance/2)) > 1e-9 {
					t.Fatal("retraction must use the same slide duration as extension")
				}

				ship.UpdateModules(spec.ActivationDuration / 2)
			} else {
				ship.UpdateModules(shutdown)
			}

			if math.Abs(part.ActivationProgress) > 1e-9 {
				t.Fatal("deactivation must fully retract")
			}
		})
	}
}

func TestModuleHealthPools(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, activated := range []*float64{nil, new(6.0)} {
		spec := catalog.ModuleSpecs["autogun"]
		spec.Health = 10
		spec.HealthActivated = activated
		catalog.ModuleSpecs["autogun"] = spec
		gun := modules.Create("autogun", simulation.ObjectProperties{ID: new(int64(1))}, catalog)

		for _, active := range []float64{0, 1} {
			mount := &simulation.Mount{Health: 10}

			if activated != nil {
				mount.HealthActivated = new(*activated)
			}

			part := &simulation.Segment{Module: gun, Mount: mount, Active: active}

			if Damage(part, 1) != 1 {
				t.Fatal("healthy module should take damage")
			}

			if activated != nil && active == 1 {
				if mount.Health != 10 || *mount.HealthActivated != 5 {
					t.Fatal("active health must be independent")
				}
			} else if mount.Health != 9 {
				t.Fatal("shared or inactive health must take damage")
			}
		}
	}
}

func TestShieldHealthAndRecharge(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"shieldGeneratorSm", "shieldGeneratorMd"} {
		t.Run(id, func(t *testing.T) {
			spec := catalog.ModuleSpecs[id]
			spec.Health = 13
			spec.HealthActivated = new(31.0)
			spec.RechargeDuration = 2
			catalog.ModuleSpecs[id] = spec
			world := simulation.CreateWorld(25, catalog)
			mountPlan := simulation.NewMount([]specs.MountPoint{{X: 20, Y: 20, Fits: []string{id}}})
			plan := &simulation.SegmentPlan{Health: new(100.0), Points: &simulation.ShapeOutline{Points: []simulation.Point{{-2, -2}, {2, -2}, {2, 2}, {-2, 2}}}, Mounts: []*simulation.Mount{mountPlan}}
			ship := NewCraft(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, []*simulation.SegmentPlan{plan}, catalog)
			gun := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)

			for _, mount := range ship.Mounts() {
				if slices.Contains(mount.Fits, id) {
					ship.Fit(gun, mount)
					break
				}
			}

			parts := ship.SegmentsAtMount(gun.ModuleBase().Mount)
			var body, bubble *simulation.Segment

			for _, part := range parts {
				if part.Covers {
					bubble = part
				} else {
					body = part
				}
			}

			mount := gun.ModuleBase().Mount
			Damage(body, 5)
			ship.SetModuleActive(id, true)
			ship.UpdateModules(spec.CoverDuration)
			Damage(bubble, 17)

			if mount.Health != 8 || *mount.HealthActivated != 14 {
				t.Fatal("shield health must be separate from generator health")
			}

			saved := ship.ModuleStates()
			Damage(bubble, 100)

			if bubble.ActivationProgress != 0 {
				t.Fatal("depletion must pop the bubble immediately")
			}

			ship.UpdateModules(0)
			ship.SetModuleActive(id, true)

			if ship.ModuleActive(id) {
				t.Fatal("depleted shield must not activate")
			}

			ship.UpdateModules(spec.RechargeDuration / 2)
			ship.SetModuleActive(id, true)

			if ship.ModuleActive(id) || *mount.HealthActivated != 15.5 {
				t.Fatal("partial recharge must block activation")
			}

			ship.UpdateModules(spec.RechargeDuration / 2)
			ship.SetModuleActive(id, true)

			if !ship.ModuleActive(id) || *mount.HealthActivated != 31 {
				t.Fatal("full recharge must enable activation")
			}

			ship.SetModuleStates(saved)

			if mount.Health != 8 || *mount.HealthActivated != 14 || !ship.ModuleActive(id) {
				t.Fatal("snapshots must restore both health pools")
			}
		})
	}
}
