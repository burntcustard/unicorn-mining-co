package main

import (
	"encoding/hex"
	"fmt"
	"os"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
)

func main() {
	spec, err := definitions.Load()

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
				field.Kind: "ship", field.Position: protocol.Vector{X: -1.25, Y: 20.5},
				field.Radius: float64(40), field.Rotation: float64(0.25),
				field.Spin: float64(-0.5), field.Velocity: protocol.Vector{X: 3, Y: -4},
				field.Credits: float64(500), field.DefinitionID: "testScout",
				field.Label:         "MUSTANG",
				field.Shades:        []string{"#fff", "#000"},
				field.HullHealth:    []float64{8, 20, 40},
				field.Modules:       []protocol.ModuleState{{Type: 1, Mount: 2, ID: new(float64(-10)), Health: new(float64(20)), Shades: []string{"#a", "#b"}, Segments: []protocol.ModuleSegment{{Active: 1, ActivationProgress: 0.5}}}},
				field.CargoContents: []protocol.CargoEntry{{ModuleIndex: new(float64(2))}, {Entity: &protocol.EntityRecord{ID: 25, Fields: map[int]any{field.Kind: "item", field.Position: protocol.Vector{X: 1, Y: 2}, field.Radius: float64(6)}}}},
				field.Wreckage:      []protocol.WreckageSegment{{Radius: 8, Offset: protocol.Vector{X: 2, Y: 3}, Health: 4, ShapeOutline: [][]float64{{0, 0}, {1, 1}}, FillShade: new(float64(2)), Stroke: [][][]float64{{{0, 0}, {2, 2}}}}},
			}},
			{ID: 9, Fields: map[int]any{
				field.Kind: "asteroid", field.Position: protocol.Vector{X: 300, Y: 400},
				field.Radius: float64(30), field.Resource: float64(2),
				field.Contents:     []float64{0, 2},
				field.ShapeOutline: [][]float64{{-1, -1}, {1, -1}, {0, 1}},
				field.Segments:     []protocol.AsteroidSegment{{Contents: []float64{1, 2}, Health: 10, Mass: 5, MaxHealth: 12, ShapeOutline: [][]float64{{0, 0}, {1, 0}, {0, 1}}}},
				field.Message:      nil,
			}},
		},
	}, spec.Protocol)

	if err != nil {
		panic(err)
	}

	fmt.Fprintln(os.Stdout, hex.EncodeToString(packet))
}
