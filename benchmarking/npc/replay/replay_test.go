package replay

import (
	"bufio"
	"cmp"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/collector"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type collectorReplayItem struct {
	SectorID string `json:"sectorID"`
	ID       int64  `json:"id"`
}

type collectorReplayCounts struct {
	Loose, InRangeLoose, CollectorCargo, PirateCargo, PlayerCargo, Station, Missing int
	OutOfRangeLoose, UnlocatedDead                                                  int
	CollectorPickedAndHeld                                                          int
}

type collectorReplayShip struct {
	ID                    int64
	Name                  string
	Position              Vec.Vector
	Velocity              Vec.Vector
	Rotation, Spin        float64
	Fuel                  float64
	HullHealth            float64
	HullSegments, Modules int
	Dead                  bool
	DockedTo              *int64
	Cargo                 []int64
	State                 json.RawMessage
}

type collectorReplaySector struct {
	ID         string
	Collectors []collectorReplayShip
	Pirates    []collectorReplayShip
	Stations   json.RawMessage
}

type collectorReplaySample struct {
	Tick                 uint64
	Seconds              float64
	Cohort               collectorReplayCounts
	AllLoose, AllInRange int
	Sectors              []collectorReplaySector
	LooseItems           []collectorReplayLooseItem
}

type collectorReplayLooseItem struct {
	collectorReplayItem
	Name     string
	Position Vec.Vector
	Rotation float64
	Spin     float64
	Sleeping bool
	InRange  bool
}

type collectorReplayEvent struct {
	Tick     uint64
	Seconds  float64
	Kind     string
	SectorID string
	ItemID   int64
	ShipID   int64
	Actor    string
}

/*
TestCollectorCleanupReplay runs only when given a closed, frozen SQLite snapshot.
It retains the real fixed simulation step, NPC decision cadence, physics, and
gameplay timers. It accelerates wall time, not the simulation's update interval.
Use its CPU measurements for iteration diagnostics; validate final server CPU
under the normal watcher and wall-clock scheduler separately.
Use go test -cpuprofile and inspect cumulative GameSession.Tick costs to separate
simulation work from the replay's per-second diagnostic JSON.
*/
func TestCollectorCleanupReplay(t *testing.T) {
	source := os.Getenv("UNICORN_COLLECTOR_REPLAY_DB")

	if source == "" {
		t.Skip("set UNICORN_COLLECTOR_REPLAY_DB to a closed post-mining checkpoint")
	}

	if lock, err := os.Open(source + ".lock"); err == nil {
		defer lock.Close()

		if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_SH|syscall.LOCK_NB); err != nil {
			t.Fatal("checkpoint is in use; copy a closed snapshot instead of a running SQLite database", err)
		}
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}

	maxSeconds := 1800.0

	if value := os.Getenv("UNICORN_COLLECTOR_REPLAY_SECONDS"); value != "" {
		var err error
		maxSeconds, err = strconv.ParseFloat(value, 64)

		if err != nil || maxSeconds <= 0 || math.IsNaN(maxSeconds) || math.IsInf(maxSeconds, 0) {
			t.Fatal("UNICORN_COLLECTOR_REPLAY_SECONDS must be positive")
		}
	}

	output := os.Getenv("UNICORN_COLLECTOR_REPLAY_OUTPUT")

	if output == "" {
		output = filepath.Join(t.TempDir(), "collector-replay.json")
	}

	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		t.Fatal(err)
	}

	timeline, err := os.Create(output + ".jsonl")

	if err != nil {
		t.Fatal(err)
	}

	defer timeline.Close()
	buffer := bufio.NewWriterSize(timeline, 64*1024)
	defer buffer.Flush()
	encoder := json.NewEncoder(buffer)

	database := filepath.Join(t.TempDir(), "world.sqlite")
	digest := sha256.New()
	databaseHash := ""
	checkpointFiles := map[string]any{}

	for _, suffix := range []string{"", "-wal", "-shm"} {
		file, err := os.Open(source + suffix)

		if os.IsNotExist(err) && suffix != "" {
			continue
		}

		if err != nil {
			t.Fatal(err)
		}

		copy, err := os.Create(database + suffix)

		if err != nil {
			file.Close()
			t.Fatal(err)
		}

		digest.Write([]byte(suffix))
		fileDigest := sha256.New()
		bytes, copyErr := io.Copy(io.MultiWriter(copy, digest, fileDigest), file)
		closeErr, sourceErr := copy.Close(), file.Close()

		if copyErr != nil || closeErr != nil || sourceErr != nil {
			t.Fatal(copyErr, closeErr, sourceErr)
		}

		checksum := fmt.Sprintf("%x", fileDigest.Sum(nil))
		checkpointFiles[filepath.Base(source)+suffix] = map[string]any{"bytes": bytes, "sha256": checksum}

		if suffix == "" {
			databaseHash = checksum
		}
	}

	db, err := sql.Open("sqlite", database)

	if err != nil {
		t.Fatal(err)
	}

	var seed float64
	err = db.QueryRow("SELECT seed FROM world WHERE id=1").Scan(&seed)
	closeErr := db.Close()

	if err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
	}

	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	clock := time.Unix(0, 0)

	s := network.NewGameSession(seed, catalog, network.SessionOptions{Now: func() time.Time { return clock }})

	store, err := persistence.Open(database, "")

	if err != nil {
		t.Fatal(err)
	}

	if err := s.EnablePersistence(store); err != nil {
		store.Close(context.Background())
		t.Fatal(err)
	}

	storeClosed := false

	defer func() {
		if !storeClosed {
			store.Close(context.Background())
		}
	}()

	startTick := s.World.Tick
	step := catalog.Simulation.SimulationStep

	var cohort []collectorReplayItem

	if manifest := os.Getenv("UNICORN_COLLECTOR_REPLAY_COHORT"); manifest != "" {
		data, err := os.ReadFile(manifest)

		if err != nil {
			t.Fatal(err)
		}

		if err := json.Unmarshal(data, &cohort); err != nil {
			t.Fatal(err)
		}
	} else {
		s.VisitSectors(func(state network.SectorView) {
			sector := state.ID

			visit := func(entity simulation.Entity, id int64) {
				if collector.Eligible(entity) {
					cohort = append(cohort, collectorReplayItem{SectorID: sector, ID: id})
				}
			}

			state.World.Entities.ForEach(visit)
			state.Environment.Sleeping(visit)
		})
	}

	if len(cohort) == 0 {
		t.Fatal("checkpoint contains no eligible loose-item cohort")
	}

	slices.SortFunc(cohort, func(a, b collectorReplayItem) int {
		return cmp.Compare(a.ID, b.ID)
	})

	wanted := map[int64]collectorReplayItem{}

	for _, item := range cohort {
		if _, exists := wanted[item.ID]; exists {
			t.Fatalf("duplicate cohort item %d", item.ID)
		}

		wanted[item.ID] = item
	}

	// Retain object identity even if a sold module receives a station-stock ID.
	identities := map[*simulation.GameObject]int64{}

	s.VisitSectors(func(state network.SectorView) {
		visit := func(entity simulation.Entity, id int64) {
			if _, exists := wanted[id]; exists {
				identities[entity.Base()] = id
			}
		}

		state.World.Entities.ForEach(visit)
		state.Environment.Sleeping(visit)
	})

	var observationErr error

	write := func(value any) {
		if observationErr == nil {
			observationErr = encoder.Encode(value)
		}
	}

	pickups := map[int64]bool{}
	var collectorPickedAt, lastCollectorPickupAt *float64
	inspectID := int64(0)
	inspectAt := 0.0

	if value := os.Getenv("UNICORN_COLLECTOR_REPLAY_INSPECT_ITEM"); value != "" {
		inspectID, err = strconv.ParseInt(value, 10, 64)

		if err != nil {
			t.Fatal(err)
		}

		if value := os.Getenv("UNICORN_COLLECTOR_REPLAY_INSPECT_SECONDS"); value != "" {
			inspectAt, err = strconv.ParseFloat(value, 64)

			if err != nil || inspectAt < 0 || math.IsNaN(inspectAt) || math.IsInf(inspectAt, 0) {
				t.Fatal("UNICORN_COLLECTOR_REPLAY_INSPECT_SECONDS must be finite and nonnegative")
			}
		}
	}

	s.VisitSectors(func(state network.SectorView) {
		sector := state.ID
		previous := state.World.EntityChanged

		state.World.EntityChanged = func(entity simulation.Entity, deleted bool) {
			if previous != nil {
				previous(entity, deleted)
			}

			id, tracked := identities[entity.Base()]

			if !deleted || !tracked {
				return
			}

			event := collectorReplayEvent{Tick: state.World.Tick, Seconds: float64(state.World.Tick-startTick) * step, Kind: "removed", SectorID: sector, ItemID: id}

			state.Collectors.ForEachShip(func(ship *objects.Ship) {
				for _, cargo := range ship.CargoContents {
					if cargo == entity {
						event.Kind, event.Actor, event.ShipID = "pickup", "collector", ship.ID
						pickups[id] = true
						lastCollectorPickupAt = new(event.Seconds)
					}
				}
			})

			state.Pirates.ForEachShip(func(ship *objects.Ship) {
				for _, cargo := range ship.CargoContents {
					if cargo == entity {
						event.Kind, event.Actor, event.ShipID = "pickup", "pirate", ship.ID
					}
				}
			})

			write(event)
		}
	})

	initial := sampleCollectorReplay(s, startTick, wanted, identities, pickups)
	write(initial)
	knownCollectors := map[int64]bool{}
	var firstLaunchAt, firstNewLaunchAt *float64

	for _, state := range initial.Sectors {
		for _, npc := range state.Collectors {
			knownCollectors[npc.ID] = true
			firstLaunchAt = new(0.0)
		}
	}

	var cpuBefore, cpuAfter syscall.Rusage
	syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore)
	started := time.Now()
	maxTick := startTick + uint64(maxSeconds/step)
	every := max(uint64(1), uint64(1/step))
	var cohortClearedAt, inRangeClearedAt, depositedAt, t50, t90 *float64
	maximumCollectors, stalls := 0, 0
	final := initial

	for s.World.Tick < maxTick {
		before := s.World.Tick
		s.Tick(1)

		if s.World.Tick == before {
			if err := store.Err(); err != nil {
				t.Fatal(err)
			}

			stalls++
			time.Sleep(time.Millisecond)
			continue
		}

		clock = time.Unix(0, 0).Add(time.Duration(float64(s.World.Tick-startTick) * step * float64(time.Second)))

		s.VisitSectors(func(state network.SectorView) {
			sector := state.ID

			state.Collectors.ForEachShip(func(ship *objects.Ship) {
				if knownCollectors[ship.ID] {
					return
				}

				knownCollectors[ship.ID] = true
				seconds := float64(s.World.Tick-startTick) * step

				if firstLaunchAt == nil {
					firstLaunchAt = new(seconds)
				}

				if firstNewLaunchAt == nil {
					firstNewLaunchAt = new(seconds)
				}

				write(collectorReplayEvent{Tick: s.World.Tick, Seconds: seconds, Kind: "launch", SectorID: sector, ShipID: ship.ID, Actor: "collector"})
			})
		})

		if (s.World.Tick-startTick)%every != 0 && s.World.Tick != maxTick {
			continue
		}

		final = sampleCollectorReplay(s, startTick, wanted, identities, pickups)
		write(final)

		if inspectID != 0 && final.Seconds >= inspectAt {
			write(collectorReplayGeometry(s, startTick, inspectID))
			inspectID = 0
		}

		active := 0

		for _, state := range final.Sectors {
			active += len(state.Collectors)
		}

		maximumCollectors = max(maximumCollectors, active)

		if t50 == nil && final.Cohort.CollectorPickedAndHeld >= int(math.Ceil(float64(len(wanted))*0.5)) {
			t50 = new(final.Seconds)
		}

		if t90 == nil && final.Cohort.CollectorPickedAndHeld >= int(math.Ceil(float64(len(wanted))*0.9)) {
			t90 = new(final.Seconds)
		}

		if collectorPickedAt == nil && final.Cohort.CollectorPickedAndHeld == len(wanted) {
			collectorPickedAt = new(final.Seconds)
		}

		if cohortClearedAt == nil && final.Cohort.Loose == 0 && final.Cohort.Missing == 0 {
			cohortClearedAt = new(final.Seconds)
		}

		if inRangeClearedAt == nil && final.AllInRange == 0 {
			inRangeClearedAt = new(final.Seconds)
		}

		if depositedAt == nil && final.Cohort.Station == len(cohort) {
			depositedAt = new(final.Seconds)
		}
	}

	syscall.Getrusage(syscall.RUSAGE_SELF, &cpuAfter)
	elapsed := time.Since(started).Seconds()
	cpuSeconds := float64(cpuAfter.Utime.Nano()+cpuAfter.Stime.Nano()-cpuBefore.Utime.Nano()-cpuBefore.Stime.Nano()) / float64(time.Second)

	afterLaunch := func(at *float64) *float64 {
		if at == nil || firstLaunchAt == nil {
			return nil
		}

		return new(*at - *firstLaunchAt)
	}

	summary := map[string]any{
		"checkpoint": source, "checkpointSHA256": databaseHash, "checkpointBundleSHA256": fmt.Sprintf("%x", digest.Sum(nil)), "checkpointFiles": checkpointFiles,
		"cohortManifest": os.Getenv("UNICORN_COLLECTOR_REPLAY_COHORT"), "initialCohort": cohort,
		"initial": initial, "final": final, "cohortClearedSeconds": cohortClearedAt,
		"cohortCollectorPickedSeconds":     collectorPickedAt,
		"cohortLastCollectorPickupSeconds": lastCollectorPickupAt,
		"firstLaunchSeconds":               firstLaunchAt, "firstNewLaunchSeconds": firstNewLaunchAt,
		"cohortT50Seconds": t50, "cohortT90Seconds": t90, "cohortT100Seconds": collectorPickedAt,
		"cohortT50AfterFirstLaunchSeconds": afterLaunch(t50), "cohortT90AfterFirstLaunchSeconds": afterLaunch(t90), "cohortT100AfterFirstLaunchSeconds": afterLaunch(collectorPickedAt),
		"inRangeClearedSeconds": inRangeClearedAt, "allCohortDepositedSeconds": depositedAt,
		"collectorPickupCount": len(pickups), "maximumCollectors": maximumCollectors,
		"simulationStepSeconds": step, "decisionIntervalSeconds": catalog.NPCMovement.DecisionInterval,
		"simulationSeconds": final.Seconds, "wallSeconds": elapsed, "processCPUSeconds": cpuSeconds,
		"processCPUSecondsPerSimulationSecond": cpuSeconds / max(final.Seconds, step), "persistenceStalls": stalls,
		"GOMEMLIMIT": os.Getenv("GOMEMLIMIT"), "GOGC": os.Getenv("GOGC"), "GOMAXPROCS": runtime.GOMAXPROCS(0), "GODEBUG": os.Getenv("GODEBUG"), "GOEXPERIMENT": os.Getenv("GOEXPERIMENT"),
		"notes": "Accelerated full-session replay of a cloned closed SQLite checkpoint. Position rounding, temporary-object removal, stationary disconnected players and rebuilt navigation caches match ordinary restart. Future station intervals retain production randomness unless the same documented compiler overlay is supplied. Cleanup times are observed every simulated second and require confirmed collector pickups still held by collectors or stations. First launch is zero when a collector was already active at the checkpoint. Test-process CPU includes diagnostic JSON and persistence; use -cpuprofile to attribute GameSession.Tick costs and validate production CPU under the real server.",
	}

	if destination := os.Getenv("UNICORN_COLLECTOR_REPLAY_EXPORT_DB"); destination != "" {
		if err := s.Shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}

		err := store.Close(context.Background())
		storeClosed = true

		if err != nil {
			t.Fatal(err)
		}

		if info, err := os.Stat(database + "-wal"); err == nil && info.Size() > 0 || err != nil && !os.IsNotExist(err) {
			t.Fatal("closed replay database still has a WAL or cannot be inspected", err)
		}

		if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
			t.Fatal(err)
		}

		file, err := os.Open(database)

		if err != nil {
			t.Fatal(err)
		}

		copy, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)

		if err != nil {
			file.Close()
			t.Fatal(err)
		}

		digest := sha256.New()
		bytes, copyErr := io.Copy(io.MultiWriter(copy, digest), file)
		closeErr, sourceErr := copy.Close(), file.Close()

		if copyErr != nil || closeErr != nil || sourceErr != nil {
			t.Fatal(copyErr, closeErr, sourceErr)
		}

		summary["exportedCheckpoint"] = map[string]any{"path": destination, "bytes": bytes, "sha256": fmt.Sprintf("%x", digest.Sum(nil)), "tick": s.World.Tick, "simulationSeconds": final.Seconds, "notes": "Ordinary graceful shutdown captures active mechanics and semantic timers; the next load applies normal restart normalization and rebuilds navigation caches."}
	}

	data, err := json.MarshalIndent(summary, "", "  ")

	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(output, append(data, '\n'), 0644); err != nil {
		t.Fatal(err)
	}

	if err := buffer.Flush(); err != nil {
		t.Fatal(err)
	}

	if observationErr != nil {
		t.Fatal(observationErr)
	}

	t.Logf("replay: cohort=%d loose=%d missing=%d station=%d simulation=%.1fs CPU=%.3fs wall=%.3fs output=%s", len(cohort), final.Cohort.Loose, final.Cohort.Missing, final.Cohort.Station, final.Seconds, cpuSeconds, elapsed, output)
}

func sampleCollectorReplay(s *network.GameSession, start uint64, wanted map[int64]collectorReplayItem, identities map[*simulation.GameObject]int64, pickups map[int64]bool) collectorReplaySample {
	sample := collectorReplaySample{Tick: s.World.Tick, Seconds: float64(s.World.Tick-start) * s.World.Specification.Simulation.SimulationStep}
	locations := map[int64]string{}

	identify := func(entity simulation.Entity, location string) {
		id, tracked := identities[entity.Base()]

		if !tracked {
			id = entity.Base().ID
			_, tracked = wanted[id]
		}

		if tracked {
			identities[entity.Base()] = id
			locations[id] = location
		}
	}

	s.VisitSectors(func(state network.SectorView) {
		sector := state.ID

		inRange := func(position Vec.Vector) bool {
			radius := state.World.Specification.CollectorSpec.OperatingRadius

			for _, station := range state.Collectors.Stations {
				if Vec.DistanceSquared(position, station.Home.Position) <= radius*radius {
					return true
				}
			}

			return false
		}

		visit := func(entity simulation.Entity, sleeping bool) {
			if collector.Eligible(entity) {
				covered := inRange(entity.Base().Position)
				sample.AllLoose++

				if covered {
					sample.AllInRange++
				}

				identify(entity, "loose")

				if _, tracked := identities[entity.Base()]; tracked && covered {
					sample.Cohort.InRangeLoose++
				}

				sample.LooseItems = append(sample.LooseItems, collectorReplayLooseItem{collectorReplayItem: collectorReplayItem{SectorID: sector, ID: entity.Base().ID}, Name: entity.Base().Name, Position: entity.Base().Position, Rotation: entity.Base().Rotation, Spin: entity.Base().Spin, Sleeping: sleeping, InRange: covered})
			}

			if station, ok := entity.(*objects.Station); ok {
				for _, item := range station.CargoContents {
					identify(item, "station")
				}
			}
		}

		state.World.Entities.ForEach(func(entity simulation.Entity, _ int64) { visit(entity, false) })

		state.Environment.Sleeping(func(entity simulation.Entity, _ int64) { visit(entity, true) })

		record := collectorReplaySector{ID: sector, Stations: state.Collectors.CaptureDispatch()}

		shipRecord := func(ship *objects.Ship, location string, data json.RawMessage) collectorReplayShip {
			hull, modules := ai.Equipment(ship)
			record := collectorReplayShip{ID: ship.ID, Name: ship.Name, Position: ship.Position, Velocity: ship.Velocity, Rotation: ship.Rotation, Spin: ship.Spin, Fuel: ship.Fuel, HullHealth: ship.HullHealthTotal(), HullSegments: hull, Modules: modules, Dead: ship.Dead, State: data}

			if ship.DockedTo != nil {
				record.DockedTo = new(*ship.DockedTo)
			}

			for _, item := range ship.CargoContents {
				identify(item, location)
				record.Cargo = append(record.Cargo, item.Base().ID)
			}

			return record
		}

		collectorStates := make(map[int64]json.RawMessage)

		for _, saved := range state.Collectors.Capture() {
			collectorStates[saved.ID] = saved.State
		}

		state.Collectors.ForEachShip(func(ship *objects.Ship) {
			record.Collectors = append(record.Collectors, shipRecord(ship, "collector", collectorStates[ship.ID]))
		})

		pirateStates := make(map[int64]json.RawMessage)

		for _, saved := range state.Pirates.Capture() {
			pirateStates[saved.ID] = saved.State
		}

		state.Pirates.ForEachShip(func(ship *objects.Ship) {
			var saved struct {
				Destination Vec.Vector
				ThinkAfter  float64
			}

			_ = json.Unmarshal(pirateStates[ship.ID], &saved)
			data, _ := json.Marshal(map[string]any{"State": ship.NPCState, "Destination": saved.Destination, "ThinkAfter": saved.ThinkAfter})
			record.Pirates = append(record.Pirates, shipRecord(ship, "pirate", data))
		})

		sample.Sectors = append(sample.Sectors, record)
	})

	s.VisitPlayers(func(p ai.Player) {
		for _, item := range p.Ship().CargoContents {
			identify(item, "player")
		}
	})

	for id := range wanted {
		if pickups[id] && (locations[id] == "collector" || locations[id] == "station") {
			sample.Cohort.CollectorPickedAndHeld++
		}

		switch locations[id] {
		case "loose":
			sample.Cohort.Loose++
		case "collector":
			sample.Cohort.CollectorCargo++
		case "pirate":
			sample.Cohort.PirateCargo++
		case "player":
			sample.Cohort.PlayerCargo++
		case "station":
			sample.Cohort.Station++
		default:
			sample.Cohort.Missing++
		}
	}

	for object, id := range identities {
		if locations[id] == "" && object.Dead {
			sample.Cohort.UnlocatedDead++
		}
	}

	sample.Cohort.OutOfRangeLoose = sample.Cohort.Loose - sample.Cohort.InRangeLoose

	slices.SortFunc(sample.Sectors, func(a, b collectorReplaySector) int {
		return cmp.Compare(a.ID, b.ID)
	})

	slices.SortFunc(sample.LooseItems, func(a, b collectorReplayLooseItem) int {
		return cmp.Compare(a.ID, b.ID)
	})

	return sample
}

// An opt-in, single snapshot helps reproduce a difficult pickup without adding
// geometry collection to normal CPU measurements.
func collectorReplayGeometry(s *network.GameSession, start uint64, id int64) map[string]any {
	snapshot := map[string]any{"Kind": "geometry", "ItemID": id, "Tick": s.World.Tick, "Seconds": float64(s.World.Tick-start) * s.World.Specification.Simulation.SimulationStep}

	s.VisitSectors(func(state network.SectorView) {
		sector := state.ID

		if snapshot["SectorID"] != nil {
			return
		}

		item := state.Environment.Entity(id)

		if item == nil {
			return
		}

		snapshot["SectorID"], snapshot["Position"] = sector, item.Base().Position
		snapshot["Rotation"], snapshot["Spin"] = item.Base().Rotation, item.Base().Spin
		var obstacles []map[string]any

		visit := func(entity simulation.Entity, _ int64) {
			object := entity.Base()

			if object.Kind != "asteroid" && object.Kind != "station" && object.Kind != "jumpGate" || Vec.DistanceSquared(object.Position, item.Base().Position) > math.Pow(object.Radius+500, 2) {
				return
			}

			value := map[string]any{"ID": object.ID, "Kind": object.Kind, "Position": object.Position, "Velocity": object.Velocity, "Rotation": object.Rotation, "Spin": object.Spin, "Radius": object.Radius}

			if asteroid, ok := entity.(*simulation.Asteroid); ok {
				value["Outline"] = simulation.ShapeOutlineOf(asteroid).Points
			}

			obstacles = append(obstacles, value)
		}

		state.World.Entities.ForEach(visit)
		state.Environment.Sleeping(visit)
		snapshot["Obstacles"] = obstacles
	})

	return snapshot
}
