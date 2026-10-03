package network

import (
	"encoding/hex"
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"os"
	"runtime"
	"runtime/pprof"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

type benchmarkSocket struct {
	packets, bytes int
	sequence       uint64
	trace          []string
	record         bool
}

func (s *benchmarkSocket) IsOpen() bool       { return true }
func (s *benchmarkSocket) BufferedBytes() int { return 0 }
func (s *benchmarkSocket) SendBinary(data []byte) error {
	s.packets++
	s.bytes += len(data)
	if data[1] == 0x4d {
		offset := 4
		read := func() uint64 {
			var value uint64
			shift := 0
			for {
				part := data[offset]
				offset++
				value |= uint64(part&127) << shift
				if part&128 == 0 {
					return value
				}
				shift += 7
			}
		}
		read()
		read()
		if data[3]&4 != 0 {
			read()
		}
		if data[3]&8 != 0 {
			read()
		}
		if data[3]&16 != 0 {
			s.sequence = read()
		}
	}

	if s.record {
		s.trace = append(s.trace, hex.EncodeToString(data))
	}
	return nil
}
func (s *benchmarkSocket) Terminate()               {}
func (s *benchmarkSocket) CloseWith(uint16, string) {}

type measuredCollisions struct {
	simulation.CollisionWorld
	contacts int
	trace    []any
	events   *[]protocol.SimulationEvent
}

func (c *measuredCollisions) Step(entities *utilities.OrderedMap[int64, simulation.Entity], dt float64, events *[]protocol.SimulationEvent) []collision.Contact {
	contacts := c.CollisionWorld.Step(entities, dt, events)
	c.contacts += len(contacts)
	c.events = events
	if os.Getenv("CONTACT_TRACE") != "" {
		record := []any{}
		for _, v := range contacts {
			record = append(record, map[string]any{"a": v.Collider.Owner.(simulation.Entity).Base().ID, "b": v.Other.Owner.(simulation.Entity).Base().ID, "point": v.Point, "normal": v.Normal, "depth": v.Depth})
		}
		c.trace = append(c.trace, record)
	}
	return contacts
}
func cpuMicros() int64 {
	var usage syscall.Rusage
	_ = syscall.Getrusage(syscall.RUSAGE_SELF, &usage)
	return usage.Utime.Sec*1000000 + usage.Utime.Usec + usage.Stime.Sec*1000000 + usage.Stime.Usec
}
func TestSessionBenchmark(t *testing.T) {
	path := os.Getenv("SESSION_RESULT")
	if path == "" {
		t.Skip("invoked by benchmarking/tools/go-cpu.mjs")
	}
	count, _ := strconv.Atoi(os.Getenv("SESSION_PLAYERS"))
	ticks, _ := strconv.Atoi(os.Getenv("SESSION_TICKS"))
	inputEvery := 15
	if value := os.Getenv("SESSION_INPUT_EVERY"); value != "" {
		var err error
		inputEvery, err = strconv.Atoi(value)
		if err != nil || inputEvery < 1 {
			t.Fatal("invalid SESSION_INPUT_EVERY")
		}
	}
	workload := os.Getenv("SESSION_WORKLOAD")
	trace := os.Getenv("SESSION_TRACE") != ""
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	seed := 25.0
	if value := os.Getenv("SESSION_SEED"); value != "" {
		seed, err = strconv.ParseFloat(value, 64)
		if err != nil {
			t.Fatal(err)
		}
	}
	session := NewGameSession(seed, catalog)
	sockets := make([]*benchmarkSocket, count)
	players := make([]*playerRecord, count)
	for i := range sockets {
		sockets[i] = &benchmarkSocket{}
		session.Receive(protocol.Control{Type: "hello"}, sockets[i])
		players[i] = session.playersBySocket[sockets[i]]
	}
	// Keep procedural region lifecycle active; controlled ships use the same
	// positions and injected drilling targets in both implementations.
	for i, p := range players {
		x, y := float64(i)*120, 10000.0
		if workload == "spread" {
			x = float64(i) * 5000
			y += float64(i) * 2000
		}
		if workload == "contact" {
			x = float64(i/2)*400 + float64(i%2)*65
			if i%2 == 1 {
				p.ship.Rotation = 3.141592653589793
			}
		}
		if workload == "module" {
			x = float64(i) * 400
		}
		p.ship.Position = Vec.Vector{X: x, Y: y}
		if workload == "module" {
			id := simulation.EntityID(session.World)
			radius := 25.0
			a := simulation.CreateAsteroid(session.World, simulation.AsteroidProperties{ID: &id, Position: Vec.Vector{X: x + 85, Y: y}, Radius: &radius, Contents: []int{0, 1}}).LockGeometry()
			simulation.AddEntity(session.World, a)
		}
		sockets[i].packets = 0
		sockets[i].bytes = 0
		sockets[i].record = trace
	}
	measured := &measuredCollisions{CollisionWorld: session.World.Collisions}
	session.World.Collisions = measured
	events := map[string]int{}
	nearZeroCollisions := 0
	eventTrace := []any{}
	samples := make([]float64, 0, ticks)
	run := func(tick int) {
		if workload == "module" && tick >= 120 && tick%120 == 0 {
			for _, p := range players {
				if !session.World.Entities.Has(p.shipID) {
					continue
				}
				id := simulation.EntityID(session.World)
				radius := 25.0
				position := simulation.MovePoint(p.ship.Position, p.ship.Rotation, 85)
				simulation.AddEntity(session.World, simulation.CreateAsteroid(session.World, simulation.AsteroidProperties{ID: &id, Position: position, Radius: &radius, Contents: []int{0, 1}}).LockGeometry())
			}
		}

		for i := range players {
			session.Receive(protocol.Control{Type: "snapshotAck", Sequence: sockets[i].sequence}, sockets[i])
			if tick%inputEvery == 0 && workload != "idle" {
				input := protocol.Input{Thrust: 1}
				if workload == "spread" {
					input.Turn = float64(i%3 - 1)
				}
				if workload == "module" {
					input.HornDrill = true
					input.CargoHatch = tick%120 < 60
					input.SearchLight = tick%180 < 90
				}
				session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: uint64(tick + 1), Input: input, Offset: 0.01, HasOffset: true}, sockets[i])
			}
		}
		session.Tick(1)
		if measured.events != nil {
			for _, event := range *measured.events {
				switch event.(type) {
				case protocol.CollisionEvent:
					if trace {
						v := event.(protocol.CollisionEvent)
						eventTrace = append(eventTrace, map[string]any{"tick": session.World.Tick, "a": v.A, "b": v.B, "impact": v.Impact})
					}
					if event.(protocol.CollisionEvent).Impact <= 2e-8 {
						nearZeroCollisions++
					} else {
						events["collision"]++
					}
				case protocol.DrillDamage:
					events["drillDamage"]++
				case protocol.AsteroidSplit:
					events["asteroidSplit"]++
				case protocol.AsteroidDestroyed:
					events["asteroidDestroyed"]++
				case protocol.ModuleChanged:
					events["moduleChanged"]++
				case protocol.ItemCollected:
					events["itemCollected"]++
				case protocol.Docked:
					events["docked"]++
				}
			}
		}
	}
	for tick := range 120 {
		run(tick)
	}
	measured.contacts = 0
	clear(events)
	nearZeroCollisions = 0
	for _, s := range sockets {
		s.packets = 0
		s.bytes = 0
		s.trace = nil
	}
	var beforeMemory runtime.MemStats
	runtime.ReadMemStats(&beforeMemory)
	if profile := os.Getenv("SESSION_CPU_PROFILE"); profile != "" {
		f, err := os.Create(profile)
		if err != nil {
			t.Fatal(err)
		}
		if err = pprof.StartCPUProfile(f); err != nil {
			t.Fatal(err)
		}
		defer f.Close()
	}
	startCPU := cpuMicros()
	start := time.Now()
	for tick := 120; tick < 120+ticks; tick++ {
		before := time.Now()
		run(tick)
		samples = append(samples, float64(time.Since(before).Nanoseconds())/1e6)
	}
	elapsed := time.Since(start).Seconds() * 1000
	cpu := float64(cpuMicros()-startCPU) / 1000
	if os.Getenv("SESSION_CPU_PROFILE") != "" {
		pprof.StopCPUProfile()
	}
	sort.Float64s(samples)
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	status, _ := os.ReadFile("/proc/self/status")
	var rss int64
	for line := range strings.SplitSeq(string(status), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
			rss, _ = strconv.ParseInt(strings.Fields(line)[1], 10, 64)
			rss *= 1024
		}
	}
	packets, bytes := 0, 0
	traces := [][]string{}
	for _, s := range sockets {
		packets += s.packets
		bytes += s.bytes
		if trace {
			traces = append(traces, s.trace)
		}
	}
	states := []any{}
	for _, p := range players {
		ship := p.ship
		states = append(states, map[string]any{"id": ship.ID, "position": ship.Position, "velocity": ship.Velocity, "rotation": ship.Rotation, "spin": ship.Spin, "hullHealth": ship.HullHealth(), "cargo": len(ship.CargoContents), "modules": ship.ModuleStates()})
	}
	result := map[string]any{"eventTrace": eventTrace, "contactTrace": measured.trace, "nearZeroCollisions": nearZeroCollisions, "runtime": "go", "seed": seed, "players": count, "workload": workload, "ticks": ticks, "cpuMsPerTick": cpu / float64(ticks), "wallMsPerTick": elapsed / float64(ticks), "p95Ms": samples[int(float64(ticks)*.95)], "p99Ms": samples[int(float64(ticks)*.99)], "maxMs": samples[ticks-1], "rssBytes": rss, "heapBytes": memory.HeapAlloc, "allocatedBytesPerTick": float64(memory.TotalAlloc-beforeMemory.TotalAlloc) / float64(ticks), "allocationsPerTick": float64(memory.Mallocs-beforeMemory.Mallocs) / float64(ticks), "collections": memory.NumGC - beforeMemory.NumGC, "contacts": measured.contacts, "events": events, "packets": packets, "bytes": bytes, "entities": session.World.Entities.Len(), "states": states, "traces": traces}
	result["inputEvery"] = inputEvery
	result["gomaxprocs"] = runtime.GOMAXPROCS(0)
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}
