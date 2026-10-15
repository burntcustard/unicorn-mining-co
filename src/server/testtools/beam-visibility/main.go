// Real replication packets for the client beam visibility regression.
package main

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	testsupport "github.com/burntcustard/unicorn-mining-co/tests/support"
)

func main() {
	catalog, err := testsupport.Load()

	if err != nil {
		panic(err)
	}

	world := simulation.CreateWorld(25, catalog)
	observer := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(1))})
	remote := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(2)), Position: Vec.Create(100, 100)})
	simulation.AddEntity(world, observer)
	simulation.AddEntity(world, remote)
	beam := modules.Create("laser", simulation.ObjectProperties{World: world}, catalog)

	for _, mount := range remote.Mounts() {
		if slices.Contains(mount.Fits, "laser") {
			remote.Fit(beam, mount)
			break
		}
	}

	remote.SetModuleActive("laser", true)
	remote.UpdateModules(beam.ModuleBase().Spec.ActivationDuration)
	replica := network.NewBinaryReplicationManager(catalog)
	options := network.SnapshotOptions{World: world, ShipID: observer.ID}
	packets := []string{hex.EncodeToString(replica.Initial(options))}

	for _, firing := range []bool{true, false, true} {
		remote.Firing = firing
		world.Tick++
		packets = append(packets, hex.EncodeToString(replica.Snapshot(options)))
	}

	join := network.NewBinaryReplicationManager(catalog).Initial(options)
	remote.SetModuleActive("laser", false)
	world.Tick++
	packets = append(packets, hex.EncodeToString(replica.Snapshot(options)))

	if err = json.NewEncoder(os.Stdout).Encode(struct {
		Packets    []string `json:"packets"`
		Join       string   `json:"join"`
		ObserverID int64    `json:"observerId"`
		RemoteID   int64    `json:"remoteId"`
	}{packets, hex.EncodeToString(join), observer.ID, remote.ID}); err != nil {
		panic(err)
	}
}
