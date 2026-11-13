package network

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestNavBeaconReplicationKind(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(123, catalog)
	beacon := objects.NewNavBeacon(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	simulation.AddEntity(world, beacon)
	batch := NewBinarySnapshotBatch(catalog)
	batch.Begin(NewReplicationView(world))
	record := batch.prepared(beacon)
	kind := record.fields[catalog.Protocol.BinaryFieldIDs.Kind]

	if kind.wire != "navBeacon" {
		t.Fatalf("replicated kind = %v", kind.wire)
	}

	if _, err := protocol.AppendField(nil, catalog.Protocol.BinaryFieldIDs.Kind, kind.wire, catalog.Protocol); err != nil {
		t.Fatal(err)
	}
}
