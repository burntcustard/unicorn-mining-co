package main

import (
	"encoding/hex"
	"fmt"
	"os"

	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

func main() {
	spec, err := specification.Load()
	if err != nil {
		panic(err)
	}
	field := spec.Protocol.BinaryFieldIDs
	packet, err := protocol.EncodeSnapshot(protocol.Snapshot{
		Tick: 42, NextEntityID: 100, Ack: new(uint64(9)), InputLead: new(int64(-2)),
		Sequence: new(uint64(10)), MembershipChanged: true,
		EntityIDs: []uint64{7, 9},
		Records: []protocol.EntityRecord{
			{ID: 7, Fields: map[int]any{
				field["kind"]: "ship", field["position"]: protocol.Vector{X: -1.25, Y: 20.5},
				field["radius"]: float64(40), field["rotation"]: float64(0.25),
				field["spin"]: float64(-0.5), field["velocity"]: protocol.Vector{X: 3, Y: -4},
				field["credits"]: float64(500), field["label"]: "MUSTANG",
				field["shades"]:        []string{"#fff", "#000"},
				field["hullHealth"]:    []float64{8, 20, 40},
				field["modules"]:       []protocol.ModuleState{{Type: 1, Mount: 2, ID: new(float64(-10)), Health: new(float64(20)), Shades: []string{"#a", "#b"}, Segments: []protocol.ModuleSegment{{Active: 1, ActivationProgress: 0.5}}}},
				field["cargoContents"]: []protocol.CargoEntry{{ModuleIndex: new(float64(2))}, {Entity: &protocol.EntityRecord{ID: 25, Fields: map[int]any{field["kind"]: "item", field["position"]: protocol.Vector{X: 1, Y: 2}, field["radius"]: float64(6)}}}},
				field["wreckage"]:      []protocol.WreckageSegment{{Radius: 8, Offset: protocol.Vector{X: 2, Y: 3}, Health: 4, ShapeOutline: [][]float64{{0, 0}, {1, 1}}, FillShade: new(float64(2)), Stroke: [][][]float64{{{0, 0}, {2, 2}}}}},
			}},
			{ID: 9, Fields: map[int]any{
				field["kind"]: "asteroid", field["position"]: protocol.Vector{X: 300, Y: 400},
				field["radius"]: float64(30), field["resource"]: float64(2),
				field["contents"]:     []float64{0, 2},
				field["shapeOutline"]: [][]float64{{-1, -1}, {1, -1}, {0, 1}},
				field["segments"]:     []protocol.AsteroidSegment{{Contents: []float64{1, 2}, Health: 10, Mass: 5, MaxHealth: 12, ShapeOutline: [][]float64{{0, 0}, {1, 0}, {0, 1}}}},
				field["message"]:      nil,
			}},
		},
	}, spec.Protocol)
	if err != nil {
		panic(err)
	}
	fmt.Fprintln(os.Stdout, hex.EncodeToString(packet))
}
