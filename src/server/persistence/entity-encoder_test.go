package persistence

import (
	"bytes"
	"math"
	"reflect"
	"syscall"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// Priming a zero value discovers all reachable concrete types. Interfaces would
// allow later values to introduce descriptors after that fixed prefix.
func TestSavedEntityHasConcreteGobFields(t *testing.T) {
	seen := map[reflect.Type]bool{}
	var check func(reflect.Type, string)

	check = func(value reflect.Type, path string) {
		if seen[value] {
			return
		}

		seen[value] = true

		switch value.Kind() {
		case reflect.Interface:
			t.Errorf("%s has interface type %s; a fixed Gob descriptor prefix is unsafe", path, value)
		case reflect.Pointer, reflect.Array, reflect.Slice:
			check(value.Elem(), path+"[]")
		case reflect.Map:
			check(value.Key(), path+"{key}")
			check(value.Elem(), path+"{value}")
		case reflect.Struct:
			for i := 0; i < value.NumField(); i++ {
				field := value.Field(i)

				if field.IsExported() {
					check(field.Type, path+"."+field.Name)
				}
			}
		}
	}

	check(reflect.TypeFor[objects.SavedEntity](), "SavedEntity")
}

type entityEncodingFixture struct {
	name  string
	state objects.SavedEntity
}

func entityEncodingFixtures(t testing.TB) []entityEncodingFixture {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	playerID := int64(1)
	ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID}})
	item := objects.NewItem(catalog.ItemIDs[0], simulation.ObjectProperties{World: world}, catalog)
	module := modules.Create(catalog.ModuleIDs[0], simulation.ObjectProperties{World: world}, catalog)
	station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{Contents: []int{1, 2}}).LockGeometry()
	pristine := objects.CaptureEntity(asteroid)
	asteroid.Segments()[0].Health -= 0.25
	zero, minusZero := 0.0, math.Copysign(0, -1)
	zeroInt := 0
	zeroID := int64(0)
	message := "saved message"
	outline := &simulation.ShapeOutline{Points: []simulation.Point{{1, 2}, {3, 4}, {5, 1}}, Edges: []bool{false, true, false}}
	wreckage := objects.CreateWreckage(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, []objects.WreckageSegment{{ShapeOutline: outline.Points, Health: 3, FillShade: &zero, Stroke: [][][]float64{}}, {Radius: 4, Stroke: [][][]float64{{{0, 1}, {2, 3}}}}}, catalog)

	nonfinite := objects.SavedEntity{Object: objects.SavedObject{
		ID: 25, Kind: "item", Position: Vec.Create(minusZero, 4), Velocity: Vec.Create(math.Inf(1), math.Inf(-1)),
		Drag: math.NaN(), SpeedLimit: math.Float64frombits(0x7ff8000000001234), Health: math.NaN(), Price: math.Inf(1),
		RadiusEven: &minusZero, Bounciness: &zero, Message: &message, PlayerID: &zeroID,
	}, HasPower: true, Rounds: &zeroInt, DockedTo: &zeroID, HasLaunching: true}

	populated := objects.SavedEntity{
		Object:      objects.SavedObject{ID: 26, Kind: "craft", DefinitionID: "mustang", Label: "saved craft", Unlock: "RED", Position: Vec.Create(6, 7), Velocity: Vec.Create(8, 9), Rotation: 0.2, Spin: -0.3, Radius: 10, AngularDrag: 0.4, AngularInertiaScale: 2, Mass: 3, Friction: 0.5, Drag: 0.6, SpeedLimit: 11, PendingUpdateTime: 0.02, Health: 12, Decay: 4, Price: 13, Physics: true, Dead: true, Buried: true, Ballistic: true, HasPaint: true, HasResource: true, Item: true, Mined: true, Paint: 2, PointCount: 3, Resource: 1, RadiusEven: &zero, Bounciness: &zero, Message: &message, PlayerID: &zeroID, Shades: []string{"white", "red"}, ShapeOutline: outline, LocalMovementParent: 27, LocalMovementRate: 0.7, RandomState: 1234, SharedRandom: true},
		TransitTime: 1, TransitGate: 28, Fuel: 2, StoredPower: 3, HasPower: true, ThrusterPower: 4, SystemsPower: 5, Rounds: &zeroInt, ModuleType: catalog.ModuleIDs[0], Contents: []int{0, 1, 2}, MaxHealth: 6,
		AsteroidSegments: []*simulation.AsteroidSegment{{Contents: []int{1}, Health: 1, Mass: 2, MaxHealth: 3, ShapeOutline: outline}},
		HullHealth:       []float64{1, 2}, HullEdges: [][]bool{nil, {}, {false, true}},
		Modules: []objects.ModuleState{{ID: &zeroID, Health: &zero, HealthActivated: &zero, ChargeCooldown: &zero, FireCooldown: &zero, Type: 1, Mount: -1, Shades: []string{"red"}, Segments: []objects.ModuleSegmentState{{Active: 0.5, ActivationProgress: 0.2}}}}, ModuleTypes: []string{catalog.ModuleIDs[0]},
		Wreckage: []objects.WreckageSegment{{ShapeOutline: outline.Points, FillShade: &zero, Stroke: [][][]float64{{{0, 1}, {2, 3}}}}}, UnstrokedWreckage: []int{0}, ZeroFillWreckage: []int{0}, DockedTo: &zeroID, Launching: 0.4, Forward: 0.5, Turn: -0.6, HasLaunching: true,
	}

	recursive := objects.SavedEntity{Object: objects.SavedObject{ID: 29, Kind: "craft"}, CargoContents: []objects.SavedEntity{
		objects.CaptureEntity(item), objects.CaptureEntity(module),
		{Object: objects.SavedObject{ID: 30, Kind: "craft"}, CargoContents: []objects.SavedEntity{nonfinite, populated}},
	}}

	return []entityEncodingFixture{
		{"zero", objects.SavedEntity{}},
		{"item", objects.CaptureEntity(item)},
		{"module", objects.CaptureEntity(module)},
		{"ship", objects.CaptureEntity(ship)},
		{"station", objects.CaptureEntity(station)},
		{"pristine asteroid", pristine},
		{"damaged asteroid", objects.CaptureEntity(asteroid)},
		{"wreckage", objects.CaptureEntity(wreckage)},
		{"nonfinite and zero pointers", nonfinite},
		{"populated", populated},
		{"recursive cargo", recursive},
		{"empty slices", objects.SavedEntity{Contents: []int{}, HullHealth: []float64{}, HullEdges: [][]bool{}, Modules: []objects.ModuleState{}, ModuleTypes: []string{}, CargoContents: []objects.SavedEntity{}, Wreckage: []objects.WreckageSegment{}}},
	}
}

func TestEntityEncoderMatchesIndependentGobRecords(t *testing.T) {
	fixtures := entityEncodingFixtures(t)
	expected := make([][]byte, len(fixtures))
	ascending, descending, repeated := []int{}, []int{}, []int{}

	for i, fixture := range fixtures {
		var err error
		expected[i], err = Encode(fixture.state)

		if err != nil {
			t.Fatal(fixture.name, err)
		}

		ascending = append(ascending, i)
		descending = append(descending, len(fixtures)-i-1)
		repeated = append(repeated, i, 0, len(fixtures)-i-1)
	}

	for _, order := range []struct {
		name    string
		indices []int
	}{{"ascending", ascending}, {"descending", descending}, {"repeated", repeated}} {
		t.Run(order.name, func(t *testing.T) {
			encoder, err := newEntityEncoder()

			if err != nil {
				t.Fatal(err)
			}

			var retained [][]byte

			for _, index := range order.indices {
				fixture := fixtures[index]
				data, err := encoder.Encode(fixture.state)

				if err != nil {
					t.Fatal(fixture.name, err)
				}

				if !bytes.Equal(data, expected[index]) {
					t.Fatalf("%s changed independent Gob bytes: got %d bytes, expected %d", fixture.name, len(data), len(expected[index]))
				}

				var decoded objects.SavedEntity

				if err := Decode(data, &decoded); err != nil {
					t.Fatal(fixture.name, "cannot independently decode record:", err)
				}

				var original objects.SavedEntity

				if err := Decode(expected[index], &original); err != nil {
					t.Fatal(fixture.name, err)
				}

				decodedBytes, err := Encode(decoded)

				if err != nil {
					t.Fatal(fixture.name, err)
				}

				originalBytes, err := Encode(original)

				if err != nil || !bytes.Equal(decodedBytes, originalBytes) {
					t.Fatal(fixture.name, "decoded state differs from the legacy codec", err)
				}

				retained = append(retained, data)
			}

			for i, data := range retained {
				if !bytes.Equal(data, expected[order.indices[i]]) {
					t.Fatal("encoding a later entity mutated a previous record")
				}
			}
		})
	}
}

func TestEntityEncoderRecoversAfterFailedRow(t *testing.T) {
	encoder, err := newEntityEncoder()

	if err != nil {
		t.Fatal(err)
	}

	invalid := objects.SavedEntity{AsteroidSegments: []*simulation.AsteroidSegment{nil}}

	if _, err := Encode(invalid); err == nil {
		t.Fatal("invalid fixture must also fail the legacy encoder")
	}

	if _, err := encoder.Encode(invalid); err == nil {
		t.Fatal("encoder accepted a nil segment")
	}

	state := objects.SavedEntity{Object: objects.SavedObject{ID: 123, Kind: "item", Health: math.NaN()}}
	expected, err := Encode(state)

	if err != nil {
		t.Fatal(err)
	}

	for range 2 {
		data, err := encoder.Encode(state)

		if err != nil || !bytes.Equal(data, expected) {
			t.Fatal("a failed row changed the bytes of a later row or retry", err)
		}
	}
}

var encodedEntityBenchmark []byte

func BenchmarkEntityEncoding(b *testing.B) {
	for _, fixture := range entityEncodingFixtures(b) {
		switch fixture.name {
		case "item", "damaged asteroid", "ship", "station":
		default:
			continue
		}

		for _, variant := range []string{"fresh", "reused"} {
			b.Run(fixture.name+"/"+variant, func(b *testing.B) {
				encode := func(state objects.SavedEntity) ([]byte, error) { return Encode(state) }

				if variant == "reused" {
					encoder, err := newEntityEncoder()

					if err != nil {
						b.Fatal(err)
					}

					encode = encoder.Encode
				}

				data, err := encode(fixture.state)

				if err != nil {
					b.Fatal(err)
				}

				encodedBytes := len(data)
				b.SetBytes(int64(len(data)))
				b.ReportAllocs()
				var before, after syscall.Rusage

				if err := syscall.Getrusage(syscall.RUSAGE_SELF, &before); err != nil {
					b.Fatal(err)
				}

				b.ResetTimer()

				for i := 0; i < b.N; i++ {
					data, err := encode(fixture.state)

					if err != nil {
						b.Fatal(err)
					}

					encodedEntityBenchmark = data
				}

				b.StopTimer()

				if err := syscall.Getrusage(syscall.RUSAGE_SELF, &after); err != nil {
					b.Fatal(err)
				}

				cpu := (after.Utime.Sec-before.Utime.Sec+after.Stime.Sec-before.Stime.Sec)*1e9 +
					(after.Utime.Usec-before.Utime.Usec+after.Stime.Usec-before.Stime.Usec)*1e3
				b.ReportMetric(float64(cpu)/float64(b.N), "cpu-ns/op")
				b.ReportMetric(float64(encodedBytes), "encoded-B/op")
			})
		}
	}
}
