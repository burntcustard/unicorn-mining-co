package protocol

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
)

type controlFixture struct {
	Client []struct {
		Message struct {
			Type, PlayerToken              string
			Tick, Sequence                 uint64
			Input                          Input
			Offset                         float64
			Action                         string
			Module, ModuleID, Mount, Paint int64
			ObjectIDs                      []int64
		}
		Hex string
	}
	Server []struct {
		Message struct {
			Type, PlayerToken            string
			PlayerID, ShipID, ServerTick uint64
			WorldSeed                    float64
			Spawn                        definitions.Vector
		}
		Hex string
	}
}

func TestControlMatchesTypeScript(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/controls.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures controlFixture
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	spec, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures.Client {
		bytes, err := hex.DecodeString(fixture.Hex)
		if err != nil {
			t.Fatal(err)
		}
		got, err := DecodeClientControl(bytes, spec.Protocol, spec.Simulation.SimulationStep)
		if err != nil {
			t.Fatalf("%s: %v", fixture.Message.Type, err)
		}
		if got.Type != fixture.Message.Type {
			t.Errorf("type: %q vs %q", got.Type, fixture.Message.Type)
		}
		switch got.Type {
		case "hello":
			if got.PlayerToken != fixture.Message.PlayerToken {
				t.Errorf("token: %q", got.PlayerToken)
			}
		case "input":
			if got.Tick != fixture.Message.Tick || got.Sequence != fixture.Message.Sequence || !reflect.DeepEqual(got.Input, fixture.Message.Input) || got.Offset != fixture.Message.Offset {
				t.Errorf("input: %+v vs %+v", got, fixture.Message)
			}
		case "dock":
			if got.Dock.Action != fixture.Message.Action || got.Dock.Module != fixture.Message.Module || got.Dock.ModuleID != fixture.Message.ModuleID || got.Dock.Mount != fixture.Message.Mount || got.Dock.Paint != fixture.Message.Paint || !reflect.DeepEqual(got.Dock.ObjectIDs, fixture.Message.ObjectIDs) {
				t.Errorf("dock: %+v vs %+v", got.Dock, fixture.Message)
			}
		case "snapshotAck":
			if got.Sequence != fixture.Message.Sequence {
				t.Errorf("ack: %d", got.Sequence)
			}
		}
	}
	for _, fixture := range fixtures.Server {
		message := fixture.Message
		got, err := EncodeServerControl(ServerControl{
			Type: message.Type, PlayerID: message.PlayerID, ShipID: message.ShipID,
			ServerTick: message.ServerTick, PlayerToken: message.PlayerToken,
			WorldSeed: message.WorldSeed, Spawn: message.Spawn,
		}, spec.Protocol)
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(got) != fixture.Hex {
			t.Errorf("%s: %x vs %s", message.Type, got, fixture.Hex)
		}
	}
}
