package objects

import (
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func turretFixture(t *testing.T, id string) (*Ship, simulation.Module) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	module := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)

	for _, mount := range ship.Mounts() {
		if slices.Contains(mount.Fits, id) {
			ship.Fit(module, mount)
			break
		}
	}

	if module.ModuleBase().Mount == nil {
		t.Fatalf("Mustang must accept %s", id)
	}

	ship.SetModuleActive(id, true)
	ship.UpdateModules(10)
	return ship, module
}

func TestTurretsTrackOnlyWhileActive(t *testing.T) {
	for _, id := range []string{"autogunTurret", "plasmaAcceleratorTurret", "laserTurret"} {
		t.Run(id, func(t *testing.T) {
			ship, module := turretFixture(t, id)
			ship.Position, ship.Rotation = Vec.Create(140, -32), math.Pi/3
			data := module.ModuleBase()
			mount := Vec.Add(ship.Position, simulation.RotatePoint(data.Mount.LocalPosition, ship.Rotation))
			target := NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(mount, simulation.RotatePoint(Vec.Create(0, 100), ship.Rotation))}, ship.Catalog)
			simulation.AddEntity(ship.World, target)
			ship.TargetID = &target.ID
			data.Spec.TurretTurnRate = 1
			ship.Update(0)

			if data.AimRotation != 0 {
				t.Fatal("a target change must not rotate the turret without elapsed time")
			}

			ship.Update(.25)

			if math.Abs(data.AimRotation-.25) > 1e-9 {
				t.Fatal("turret must turn at its configured maximum rate")
			}

			ship.updateTurrets(2)

			if math.Abs(data.AimRotation-math.Pi/2) > 1e-7 {
				t.Fatalf("turret must face target from its mount: %v", data.AimRotation)
			}

			ship.SetModuleActive(id, false)
			ship.TargetID = nil
			ship.updateTurrets(2)

			if math.Abs(data.AimRotation-math.Pi/2) > 1e-7 {
				t.Fatal("inactive turret must hold its previous angle")
			}

			ship.SetModuleActive(id, true)
			ship.updateTurrets(.25)

			if math.Abs(data.AimRotation-(math.Pi/2-.25)) > 1e-7 {
				t.Fatal("clearing a target must return forward at the maximum turn rate")
			}

			for _, targetID := range []*int64{nil, new(int64(999999)), &ship.ID, &target.ID} {
				target.Dead = true
				ship.TargetID, data.AimRotation = targetID, 1
				ship.updateTurrets(2)

				if data.AimRotation != 0 {
					t.Fatal("active turret without a valid target must face forward")
				}
			}
		})
	}
}

func TestTurretTurnTakesShortestPath(t *testing.T) {
	ship, module := turretFixture(t, "autogunTurret")
	data := module.ModuleBase()
	data.Spec.TurretTurnRate = 1
	data.AimRotation = math.Pi - .1
	angle := -math.Pi + .1
	target := NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(data.Mount.LocalPosition, simulation.RotatePoint(Vec.Create(150, 0), angle))}, ship.Catalog)
	simulation.AddEntity(ship.World, target)
	ship.TargetID = &target.ID
	ship.updateTurrets(.05)

	if math.Abs(data.AimRotation-(math.Pi-.05)) > 1e-9 {
		t.Fatal("turret must cross the angle boundary by the shortest path")
	}

	ship.updateTurrets(.2)

	if math.Abs(data.AimRotation-angle) > 1e-9 {
		t.Fatal("turret must stop at its target without overshooting")
	}

	target.Position = Vec.Add(data.Mount.LocalPosition, Vec.Create(0, 150))
	data.AimRotation = 0
	ship.updateTurrets(.3)
	singleStep := data.AimRotation
	data.AimRotation = 0

	for range 3 {
		ship.updateTurrets(.1)
	}

	if math.Abs(data.AimRotation-singleStep) > 1e-9 {
		t.Fatal("turret turn rate must be independent of the simulation step size")
	}
}

func TestTurretProjectileDirectionAndRecoil(t *testing.T) {
	for _, id := range []string{"autogunTurret", "plasmaAcceleratorTurret"} {
		t.Run(id, func(t *testing.T) {
			ship, module := turretFixture(t, id)
			data := module.ModuleBase()
			data.AimRotation = math.Pi / 2
			ship.Rotation, ship.Velocity, ship.Firing = math.Pi/3, Vec.Create(7, -3), true
			ship.CargoContents = append(ship.CargoContents, NewItem("autogunAmmo", simulation.ObjectProperties{World: ship.World}, ship.Catalog))
			rotation := ship.Rotation + data.AimRotation

			for shot := 0; shot < 2; shot++ {
				velocity := ship.Velocity
				local := simulation.RotatePoint(Vec.Create(data.Spec.BarrelLength+data.Spec.Projectile.Radius+1, 0), data.AimRotation)
				position := Vec.Add(ship.Position, simulation.RotatePoint(Vec.Add(data.Mount.LocalPosition, local), ship.Rotation))
				dt := 0.0

				if shot > 0 {
					dt = data.Spec.FireInterval
				}

				ship.fireWeapons(dt)
				count := 0

				ship.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
					projectile, ok := entity.(*Projectile)

					if !ok {
						return
					}

					count++
					expected := Vec.Add(velocity, simulation.RotatePoint(Vec.Create(data.Spec.Projectile.Speed, 0), rotation))

					if Vec.Distance(projectile.Position, position) > 1e-9 || Vec.Distance(projectile.Velocity, expected) > 1e-9 {
						t.Fatal("projectile must leave the selected barrel along the turret angle")
					}

					projectile.Remove()
				})

				if count != 1 {
					t.Fatalf("turret must retain one projectile per firing interval, got %d", count)
				}

				expected := simulation.RotatePoint(Vec.Create(-data.Spec.Recoil/ship.Mass, 0), rotation)

				if Vec.Distance(Vec.Subtract(ship.Velocity, velocity), expected) > 1e-9 {
					t.Fatal("recoil must oppose the turret's firing direction")
				}
			}
		})
	}
}

func TestTurretBeamFollowsAim(t *testing.T) {
	ship, module := turretFixture(t, "laserTurret")
	data := module.ModuleBase()
	ship.Rotation, ship.Firing = math.Pi/3, true
	data.AimRotation = math.Pi / 2
	rotation := ship.Rotation + data.AimRotation
	mount := Vec.Add(ship.Position, simulation.RotatePoint(data.Mount.LocalPosition, ship.Rotation))
	position := Vec.Add(mount, simulation.RotatePoint(Vec.Create(150, 0), rotation))
	target := NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: position, Health: new(100.0)}, ship.Catalog)
	simulation.AddEntity(ship.World, target)
	events := []protocol.SimulationEvent{}
	ship.ResolveLasers(1.0/30, &events)

	if len(events) != 1 || math.Abs(target.Health-(100-data.Spec.Damage)) > 1e-9 {
		t.Fatal("aimed beam must apply the original weapon's damage to its target")
	}

	hit := events[0].(protocol.LaserDamage)
	local := simulation.RotatePoint(Vec.Subtract(hit.Position, mount), -rotation)

	if hit.TargetID != target.ID || math.Abs(local.Y) > 1e-9 || local.X >= 150 {
		t.Fatal("beam hit must lie on the turret's firing line")
	}
}

func TestAutogunsAndTurretsConsumeSharedAmmo(t *testing.T) {
	ship, turret := turretFixture(t, "autogunTurret")
	gun := modules.Create("autogun", simulation.ObjectProperties{World: ship.World}, ship.Catalog)

	for _, mount := range ship.Mounts() {
		if slices.Contains(mount.Fits, "autogun") {
			ship.Fit(gun, mount)
			break
		}
	}

	ship.SetModuleActive("autogun", true)
	ship.UpdateModules(10)
	first := NewItem("autogunAmmo", simulation.ObjectProperties{World: ship.World}, ship.Catalog)
	second := NewItem("autogunAmmo", simulation.ObjectProperties{World: ship.World}, ship.Catalog)
	*first.Rounds, *second.Rounds = 1, 2
	ship.CargoContents, ship.Firing = []simulation.Entity{first, second}, true
	ship.fireWeapons(0)

	if len(ship.CargoContents) != 1 || ship.CargoContents[0] != second || *second.Rounds != 1 || gun.ModuleBase().FireCooldown == 0 || turret.ModuleBase().FireCooldown == 0 {
		t.Fatal("fixed and turret autoguns must consume the same ammo packs across pack boundaries")
	}
}

func TestTurretGeometryAndStateRestoration(t *testing.T) {
	ship, module := turretFixture(t, "autogunTurret")
	data := module.ModuleBase()
	parts := ship.SegmentsAtMount(data.Mount)
	ship.Hitbox()
	source := ship.GeometrySource()
	data.AimRotation = math.Pi / 2
	ship.Hitbox()

	if ship.GeometrySource() == source {
		t.Fatal("turning turret must invalidate cached collider geometry")
	}

	for i, part := range parts {
		model := data.Spec.Model[i]

		if model.TurretBase {
			if part.Outline() != nil || part.Radius(part) != model.Radius {
				t.Fatal("turret base must retain its circular shape")
			}

			continue
		}

		point := part.Outline().Points[0]

		if math.Abs(point[0]+model.Points[0][1]) > 1e-9 || math.Abs(point[1]-model.Points[0][0]) > 1e-9 {
			t.Fatal("turret geometry must rotate with its firing angle")
		}
	}

	states := ship.ModuleStates()
	data.AimRotation = 0
	ship.SetModuleStates(states)

	if data.AimRotation != math.Pi/2 {
		t.Fatal("module state must restore the current angle")
	}

	restored, err := RestoreShip(CaptureShip(ship), ship.World, *ship.PlayerID)

	if err != nil {
		t.Fatal(err)
	}

	for _, candidate := range restored.Modules() {
		state := candidate.ModuleBase()

		if state.Type == data.Type {
			if state.AimRotation != data.AimRotation {
				t.Fatal("saved ships must preserve turret angle")
			}

			return
		}
	}

	t.Fatal("restored ship lost its turret")
}
