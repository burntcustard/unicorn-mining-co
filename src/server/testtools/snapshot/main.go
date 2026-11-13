package main

import (
	"encoding/hex"
	"encoding/json"
	"math"
	"os"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func main() {
	spec, err := specs.Load()

	if err != nil {
		panic(err)
	}

	field := spec.Protocol.BinaryFieldIDs

	snapshot := protocol.Snapshot{
		Tick: 42, NextEntityID: 100, Ack: new(uint64(9)), InputLead: new(int64(-2)),
		Sequence: new(uint64(10)), MembershipChanged: true,
		EntityIDs:         []uint64{7, 9, 11, 13},
		AsteroidPositions: []protocol.Vector{{X: -2999, Y: 2}, {X: 2999, Y: 3}},
		Records: []protocol.EntityRecord{
			{ID: 7, Fields: map[int]any{
				field.Kind: "ship", field.Position: protocol.Vector{X: -1.25, Y: 20.5},
				field.Radius: float64(40), field.Rotation: float64(0.25),
				field.Spin: float64(-0.5), field.Velocity: protocol.Vector{X: 3, Y: -4},
				field.DefinitionID:  "testScout",
				field.Name:          "MUSTANG",
				field.Hostile:       true,
				field.NPCState:      "Collecting",
				field.TargetLabel:   "CUSTOM\nTARGET LABEL",
				field.BlockedBeams:  float64(10),
				field.Fuel:          float64(3.25),
				field.StoredPower:   float64(12.5),
				field.TransitTime:   float64(-1.25),
				field.TransitGate:   float64(987),
				field.Shades:        []string{"#fff", "#000"},
				field.HullHealth:    []float64{8, 20, 40},
				field.Modules:       []protocol.ModuleState{{Type: 12, Mount: 2, FireCooldown: new(float64(.375)), ChargeCooldown: new(float64(1.125)), AimRotation: new(float64(.75)), ID: new(float64(-10)), Health: new(float64(20)), Shades: spec.Colors["red"], Segments: []protocol.ModuleSegment{{Active: 1, ActivationProgress: 0.5}}}},
				field.CargoContents: []protocol.CargoEntry{{ModuleIndex: new(float64(2))}, {Entity: &protocol.EntityRecord{ID: 25, Fields: map[int]any{field.Kind: "item", field.Resource: float64(5), field.Rounds: float64(137), field.Position: protocol.Vector{X: 1, Y: 2}, field.Radius: float64(6)}}}},
				field.Wreckage:      []protocol.WreckageSegment{{Radius: 8, Offset: protocol.Vector{X: 2, Y: 3}, Health: 4, ShapeOutline: [][]float64{{0, 0}, {1, 1}}, FillShade: new(float64(2)), Color: "#fa3", Stroke: [][][]float64{{{0, 0}, {2, 2}}}}},
			}},
			{ID: 9, Fields: map[int]any{
				field.Kind: "asteroid", field.Position: protocol.Vector{X: 300, Y: 400},
				field.Radius: float64(30), field.Resource: float64(2),
				field.Contents:     []float64{0, 2},
				field.ShapeOutline: [][]float64{{-1, -1}, {1, -1}, {0, 1}},
				field.Segments:     []protocol.AsteroidSegment{{Contents: []float64{1, 2}, Health: 10, Mass: 5, MaxHealth: 12, ShapeOutline: [][]float64{{0, 0}, {1, 0}, {0, 1}}}},
				field.Message:      nil,
			}},
			{ID: 11, Fields: map[int]any{field.Kind: "projectile", field.DefinitionID: "autogun", field.PlayerId: float64(1), field.Health: float64(1.25), field.Position: protocol.Vector{X: 5, Y: 3}, field.Velocity: protocol.Vector{X: 600, Y: 0}}},
			{ID: 13, Fields: map[int]any{field.Kind: "navBeacon", field.Position: protocol.Vector{X: 100, Y: 200}, field.Rotation: float64(.25)}},
		},
	}

	boundary := float64(1<<52 - 1)
	negativeZero := math.Copysign(0, -1)

	edge := protocol.Snapshot{Tick: 42, NextEntityID: 2, Records: []protocol.EntityRecord{{ID: 1, Fields: map[int]any{
		field.Position: protocol.Vector{X: 1.1, Y: 2.2},
		field.Velocity: protocol.Vector{X: negativeZero, Y: math.Inf(1)},
		field.Rotation: math.NaN(),
		field.Spin:     math.Inf(-1),
		field.Modules: []protocol.ModuleState{
			{Type: 12, Mount: -1, ID: new(-1458.0), Health: new(20.0), HealthActivated: new(12.0), FireCooldown: new(.25), ChargeCooldown: new(.75), AimRotation: new(-.5), Shades: spec.Colors["violet"], Segments: []protocol.ModuleSegment{{Active: 0, ActivationProgress: 1}, {Active: -1, ActivationProgress: .5}, {Active: negativeZero, ActivationProgress: math.Inf(1)}, {Active: math.NaN(), ActivationProgress: math.Inf(-1)}}},
			{Type: boundary, Mount: -boundary, ID: &boundary},
		},
	}}}}

	encode := func(snapshot protocol.Snapshot) string {
		packet, err := protocol.EncodeSnapshot(snapshot, spec.Protocol)

		if err != nil {
			panic(err)
		}

		return hex.EncodeToString(packet)
	}

	module := func(id float64, palette []string, progress float64) protocol.ModuleState {
		return protocol.ModuleState{ID: &id, Type: 1, Mount: id, Shades: palette, Segments: []protocol.ModuleSegment{{Active: 1, ActivationProgress: progress}}}
	}

	initial := []protocol.ModuleState{module(1, spec.Colors["red"], 0), module(2, nil, 0), module(3, spec.Colors["orange"], 0)}
	painted := append([]protocol.ModuleState(nil), initial...)
	painted[1] = module(2, spec.Colors["violet"], .25)
	animated := append([]protocol.ModuleState(nil), painted...)
	animated[0] = module(1, spec.Colors["red"], .75)
	cleared := append([]protocol.ModuleState(nil), animated...)
	cleared[1] = module(2, nil, .5)

	pack := func(modules []protocol.ModuleState, delta *protocol.ModuleDelta, load bool) string {
		record := protocol.EntityRecord{ID: 7, Values: []protocol.FieldValue{{ID: field.Modules, Value: modules}}}
		fragment, err := protocol.AppendEntityRecordDelta(nil, record, spec.Protocol, delta)

		if err != nil {
			panic(err)
		}

		return encode(protocol.Snapshot{Load: load, Fragments: [][]byte{fragment}})
	}

	paintDelta := &protocol.ModuleDelta{Revisions: []int64{10, 11, 10}, ShadeRevisions: []int64{10, 11, 10}, Baseline: 10, LayoutRevision: 9}
	animationDelta := &protocol.ModuleDelta{Revisions: []int64{12, 11, 10}, ShadeRevisions: []int64{10, 11, 10}, Baseline: 11, LayoutRevision: 9}
	staleDelta := &protocol.ModuleDelta{Revisions: []int64{12, 11, 10}, ShadeRevisions: []int64{10, 11, 10}, Baseline: 10, LayoutRevision: 9}
	clearDelta := &protocol.ModuleDelta{Revisions: []int64{12, 13, 10}, ShadeRevisions: []int64{10, 13, 10}, Baseline: 12, LayoutRevision: 9}
	cargo := protocol.EntityRecord{ID: 8, Values: []protocol.FieldValue{{ID: field.CargoContents, Value: []protocol.CargoEntry{{Entity: &protocol.EntityRecord{ID: 9, Values: []protocol.FieldValue{{ID: field.Modules, Value: painted}}}}}}}}
	cargoFragment, err := protocol.AppendEntityRecordDelta(nil, cargo, spec.Protocol, staleDelta)

	if err != nil {
		panic(err)
	}

	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{
		"snapshot": encode(snapshot), "edge": encode(edge),
		"moduleLoad":      pack(initial, nil, true),
		"modulePaint":     pack(painted, paintDelta, false),
		"moduleAnimation": pack(animated, animationDelta, false),
		"moduleStale":     pack(animated, staleDelta, false),
		"moduleClear":     pack(cleared, clearDelta, false),
		"moduleReentry":   pack([]protocol.ModuleState{animated[2], animated[0]}, nil, true),
		"moduleCargo":     encode(protocol.Snapshot{Fragments: [][]byte{cargoFragment}}),
	}); err != nil {
		panic(err)
	}
}
