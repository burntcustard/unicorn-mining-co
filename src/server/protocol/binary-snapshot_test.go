package protocol

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestModulePaletteAndSegmentEncoding(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	id := -1458.0

	for index, palette := range catalog.Protocol.ModulePalettes {
		value := ModuleState{Type: 12, Mount: -1, ID: &id, Shades: palette, Segments: []ModuleSegment{{Active: 1, ActivationProgress: .5}}}
		actual, want := &writer{}, &writer{}

		if err := actual.modules([]ModuleState{value}, catalog.Protocol.ModulePalettes, nil); err != nil {
			t.Fatal(err)
		}

		want.unsigned(2)
		want.byte(5)
		want.signed(12)
		want.signed(-1)
		want.signed(-1458)
		want.byte(byte(index))
		want.unsigned(1)
		want.byte(9)
		want.number(.5)

		if !bytes.Equal(actual.data, want.data) {
			t.Fatalf("palette %d: %x != %x", index, actual.data, want.data)
		}
	}

	bad := &writer{}

	if err := bad.modules([]ModuleState{{Type: 1, Shades: []string{"invalid"}}}, catalog.Protocol.ModulePalettes, nil); err == nil {
		t.Fatal("non-palette shades were accepted")
	}

	if err := bad.modules([]ModuleState{{Type: float64(1 << 52)}}, catalog.Protocol.ModulePalettes, nil); err == nil {
		t.Fatal("unrepresentable module type was accepted")
	}
}

func TestPackedMotionEncoding(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	fields := catalog.Protocol.BinaryFieldIDs

	for _, value := range []float64{0, math.Copysign(0, -1), 1, -1, 0x1p-24, math.Inf(1), math.Inf(-1), math.Float64frombits(0x7ff8000000000000)} {
		actual, want := &writer{}, &writer{}

		if !actual.motionField(fields.Spin, value, catalog.Protocol) {
			t.Fatalf("value %g should be packed", value)
		}

		want.unsigned(uint64(fields.PackedSpin << 1))
		var data [8]byte
		binary.LittleEndian.PutUint64(data[:], math.Float64bits(value))
		want.data = append(want.data, data[3:]...)

		if !bytes.Equal(actual.data, want.data) {
			t.Fatalf("packed spin %g: %x != %x", value, actual.data, want.data)
		}
	}

	point := Vector{X: -3000.25, Y: math.Copysign(0, -1)}
	actual, want := &writer{}, &writer{}

	if !actual.motionField(fields.Position, point, catalog.Protocol) {
		t.Fatal("position should be packed")
	}

	want.unsigned(uint64(fields.PackedPosition << 1))

	for _, value := range []float64{point.X, point.Y} {
		var data [8]byte
		binary.LittleEndian.PutUint64(data[:], math.Float64bits(value))
		want.data = append(want.data, data[2:]...)
	}

	if !bytes.Equal(actual.data, want.data) {
		t.Fatalf("packed position: %x != %x", actual.data, want.data)
	}

	fallback := &writer{}

	if fallback.motionField(fields.Position, Vector{X: 1.1, Y: 2}, catalog.Protocol) || fallback.motionField(fields.Spin, 1.1, catalog.Protocol) || fallback.motionField(fields.Spin, math.SmallestNonzeroFloat64, catalog.Protocol) || len(fallback.data) != 0 {
		t.Fatal("non-packable values must use the exact full encoding")
	}
}

func TestSparseModuleEncodingUsesObserverBaseline(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	id := -1.0
	values := make([]ModuleState, 10)

	for i := range values {
		values[i] = ModuleState{ID: &id, Shades: catalog.Colors["red"]}
	}

	revisions := []int64{2, 6, 2, 2, 2, 2, 2, 2, 7, 2}
	shadeRevisions := []int64{2, 6, 2, 2, 2, 2, 2, 2, 2, 2}
	actual, want := &writer{}, &writer{}

	if err := actual.modules(values, catalog.Protocol.ModulePalettes, &ModuleDelta{Revisions: revisions, ShadeRevisions: shadeRevisions, Baseline: 5, LayoutRevision: 3}); err != nil {
		t.Fatal(err)
	}

	want.unsigned(21)
	want.byte(2)
	want.byte(1)
	want.byte(5) // ID and changed palette.
	want.signed(0)
	want.signed(0)
	want.signed(-1)
	want.byte(0)
	want.unsigned(0)
	want.byte(129) // ID and inherited shades.
	want.signed(0)
	want.signed(0)
	want.signed(-1)
	want.unsigned(0)

	if !bytes.Equal(actual.data, want.data) {
		t.Fatalf("sparse module bytes: %x != %x", actual.data, want.data)
	}

	full := &writer{}

	if err := full.modules(values, catalog.Protocol.ModulePalettes, &ModuleDelta{Revisions: revisions, ShadeRevisions: shadeRevisions, Baseline: 2, LayoutRevision: 3}); err != nil {
		t.Fatal(err)
	}

	if full.data[0] != 20 {
		t.Fatal("an observer predating the appearance change must receive all modules")
	}
}

func TestCompactControlValueEncoding(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		value float64
		code  byte
	}{{0, 0}, {1, 1}, {-1, 2}, {.4, 3}, {math.Inf(1), 3}} {
		actual := &writer{}

		if err := actual.field(catalog.Protocol.BinaryFieldIDs.Turn, test.value, catalog.Protocol, 0); err != nil {
			t.Fatal(err)
		}

		if actual.data[0] != test.code || (test.code == 3) != (len(actual.data) == 9) {
			t.Fatalf("control %v: invalid bytes %x", test.value, actual.data)
		}
	}
}
