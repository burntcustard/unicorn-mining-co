package network

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"testing"
)

func TestWeaponsAndPurchasedAmmoReplicate(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})
	simulation.AddEntity(world, ship)
	credits := 20.0

	for range 10 {
		if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "buyAmmo"}, &credits); !ok {
			t.Fatal("could not purchase ammunition")
		}
	}

	gun := modules.Create("autocannon", simulation.ObjectProperties{World: world}, catalog)

	for _, mount := range ship.Mounts() {
		for _, id := range mount.Fits {
			if id == "autocannon" {
				ship.Fit(gun, mount)
				break
			}
		}

		if gun.ModuleBase().Mount != nil {
			break
		}
	}

	gun.ModuleBase().FireCooldown = .075
	replica := NewBinaryReplicationManager(catalog)
	options := SnapshotOptions{World: world, ShipID: ship.ID}

	if len(replica.Initial(options)) == 0 {
		t.Fatal("weapon and purchased ammo snapshot missing")
	}

	field := catalog.Protocol.BinaryFieldIDs
	before := bytes.Clone(ship.ReplicationState.(*binaryRecord).fields[field.CargoContents].wire.([]byte))

	gun.ModuleBase().FireCooldown = .04
	*ship.CargoContents[0].(*objects.Item).Rounds = 177
	world.Tick++

	if len(replica.Snapshot(options)) == 0 {
		t.Fatal("ammo and cooldown delta missing")
	}

	after := ship.ReplicationState.(*binaryRecord).fields[field.CargoContents].wire.([]byte)

	if bytes.Equal(before, after) {
		t.Fatal("remaining rounds must replicate even when cargo item identities stay the same")
	}

	projectile := objects.NewProjectile("autocannon", simulation.ObjectProperties{World: world, ID: new(simulation.EntityID(world))}, catalog)
	simulation.AddEntity(world, projectile)
	world.Tick++

	if len(replica.Snapshot(options)) == 0 {
		t.Fatal("projectile snapshot missing")
	}
}
