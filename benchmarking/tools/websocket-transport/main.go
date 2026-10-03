package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"net"
	"net/http"
	"os"
	"runtime"
	"runtime/pprof"
	"sort"
	"sync"
	"syscall"
	"time"
)

func cpuTime() (float64, float64) {
	var usage syscall.Rusage

	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		panic(err)
	}

	return float64(usage.Utime.Sec)*1000 + float64(usage.Utime.Usec)/1000, float64(usage.Stime.Sec)*1000 + float64(usage.Stime.Usec)/1000
}

func main() {
	players := flag.Int("players", 32, "WebSocket connections")
	size := flag.Int("size", 2048, "outgoing payload bytes")
	ticks := flag.Int("ticks", 3000, "measured exchanges per connection")
	warmup := flag.Int("warmup", 120, "warmup exchanges per connection")
	hz := flag.Float64("hz", 0, "exchange rate; zero runs as fast as possible")
	profile := flag.String("profile", "", "optional server CPU profile")
	game := flag.Bool("game", false, "run the complete 30 Hz game server")
	flag.Parse()

	if *players < 1 || *size < 8 || *ticks < 1 || *warmup < 0 || *hz < 0 {
		panic("invalid benchmark options")
	}

	if *game {
		runGame(*players, *warmup, *ticks, *profile)
		return
	}

	joined := make(chan *network.WebSocket, *players)
	acknowledged := make(chan uint64, *players)
	failures := make(chan error, *players+1)
	var readers sync.WaitGroup
	listener, err := net.Listen("tcp", "127.0.0.1:0")

	if err != nil {
		panic(err)
	}

	httpServer := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := network.Upgrade(w, r, true)

		if err != nil {
			failures <- err
			return
		}

		readers.Go(func() {
			defer socket.Terminate()
			readMessage := socket.ReadMessage

			if receiver, ok := any(socket).(interface {
				ReadMessageInto([]byte) (byte, []byte, error)
			}); ok {
				var buffer []byte

				readMessage = func() (byte, []byte, error) {
					kind, data, err := receiver.ReadMessageInto(buffer)
					buffer = data
					return kind, data, err
				}
			}

			for {
				kind, data, err := readMessage()

				if err != nil {
					if socket.IsOpen() {
						failures <- err
					}

					return
				}

				if kind != network.OpBinary || len(data) != 32 || data[0] > 1 {
					failures <- fmt.Errorf("invalid input frame: kind %d, length %d", kind, len(data))
					return
				}

				if data[0] == 1 {
					acknowledged <- binary.LittleEndian.Uint64(data[8:])
				}
			}
		})

		joined <- socket
	})}

	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			failures <- err
		}
	}()

	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(map[string]any{"address": "ws://" + listener.Addr().String() + "/game-socket"})
	sockets := make([]*network.WebSocket, *players)

	for i := range sockets {
		select {
		case sockets[i] = <-joined:
		case err := <-failures:
			panic(err)
		case <-time.After(15 * time.Second):
			panic("clients did not join")
		}
	}

	defer func() {
		for _, socket := range sockets {
			socket.Terminate()
		}

		_ = httpServer.Close()
		readers.Wait()
	}()

	payload := make([]byte, *size)

	for i := 8; i < len(payload); i++ {
		payload[i] = byte(i)
	}

	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()

	exchange := func(sequence uint64) {
		timeout.Reset(10 * time.Second)
		binary.LittleEndian.PutUint64(payload, sequence)

		for _, socket := range sockets {
			if err := socket.SendBinary(payload); err != nil {
				panic(err)
			}
		}

		for range sockets {
			select {
			case ack := <-acknowledged:
				if ack != sequence {
					panic(fmt.Sprintf("acknowledged %d, expected %d", ack, sequence))
				}
			case err := <-failures:
				panic(err)
			case <-timeout.C:
				panic("exchange timed out")
			}
		}
	}

	for i := range *warmup {
		exchange(uint64(i))
	}

	if *profile != "" {
		file, err := os.Create(*profile)

		if err != nil {
			panic(err)
		}

		defer file.Close()

		if err := pprof.StartCPUProfile(file); err != nil {
			panic(err)
		}
	}

	samples := make([]float64, *ticks)
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	user, system := cpuTime()
	start := time.Now()

	for i := range *ticks {
		if *hz != 0 {
			time.Sleep(time.Until(start.Add(time.Duration(float64(i) / *hz * float64(time.Second)))))
		}

		at := time.Now()
		exchange(uint64(*warmup + i))
		samples[i] = float64(time.Since(at)) / float64(time.Millisecond)
	}

	elapsed := float64(time.Since(start)) / float64(time.Millisecond)
	endUser, endSystem := cpuTime()
	runtime.ReadMemStats(&after)

	if *profile != "" {
		pprof.StopCPUProfile()
	}

	sort.Float64s(samples)

	_ = encoder.Encode(map[string]any{
		"players": *players, "size": *size, "ticks": *ticks, "warmup": *warmup, "hz": *hz,
		"go": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0),
		"userMs": endUser - user, "systemMs": endSystem - system,
		"cpuMsPerTick": (endUser - user + endSystem - system) / float64(*ticks),
		"wallMs":       elapsed, "exchangeP50Ms": samples[len(samples)/2], "exchangeP95Ms": samples[int(float64(len(samples))*.95)],
		"allocationsPerTick":    float64(after.Mallocs-before.Mallocs) / float64(*ticks),
		"allocatedBytesPerTick": float64(after.TotalAlloc-before.TotalAlloc) / float64(*ticks),
		"collections":           after.NumGC - before.NumGC,
		"outboundFrames":        *players * *ticks, "inboundFrames": 2 * *players * *ticks,
		"outboundPayloadBytes": *players * *ticks * *size, "inboundPayloadBytes": 2 * *players * *ticks * 32,
	})
}

func runGame(players, warmup, ticks int, profile string) {
	catalog, err := definitions.Load()

	if err != nil {
		panic(err)
	}

	game := network.NewGameServer(25, catalog)
	listener, err := game.Start(0, "dist", true)

	if err != nil {
		panic(err)
	}

	defer game.Stop(context.Background())
	encoder := json.NewEncoder(os.Stdout)
	_ = encoder.Encode(map[string]any{"address": "ws://127.0.0.1:" + fmt.Sprint(listener.Addr().(*net.TCPAddr).Port) + "/game-socket", "mode": "game"})

	if ready, err := bufio.NewReader(os.Stdin).ReadString('\n'); err != nil || ready != "ready\n" {
		panic("clients did not become ready")
	}

	period := time.Duration(catalog.Simulation.SimulationStep * float64(time.Second))
	time.Sleep(time.Duration(warmup) * period)

	if profile != "" {
		file, err := os.Create(profile)

		if err != nil {
			panic(err)
		}

		defer file.Close()

		if err := pprof.StartCPUProfile(file); err != nil {
			panic(err)
		}
	}

	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_ = encoder.Encode(map[string]any{"measuring": true})
	user, system := cpuTime()
	start := time.Now()
	time.Sleep(time.Duration(ticks) * period)
	elapsed := time.Since(start)
	endUser, endSystem := cpuTime()
	runtime.ReadMemStats(&after)

	if profile != "" {
		pprof.StopCPUProfile()
	}

	_ = encoder.Encode(map[string]any{
		"mode": "game", "players": players, "ticks": ticks, "warmup": warmup, "hz": 1 / catalog.Simulation.SimulationStep,
		"go": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0),
		"userMs": endUser - user, "systemMs": endSystem - system,
		"cpuMsPerTick":          (endUser - user + endSystem - system) / float64(ticks),
		"wallMs":                float64(elapsed) / float64(time.Millisecond),
		"allocationsPerTick":    float64(after.Mallocs-before.Mallocs) / float64(ticks),
		"allocatedBytesPerTick": float64(after.TotalAlloc-before.TotalAlloc) / float64(ticks),
		"collections":           after.NumGC - before.NumGC,
	})
}
