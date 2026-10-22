// Capture inherited user-mode PMU counters around an existing benchmark executable.
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

func main() {
	output := flag.String("o", "", "counter JSON destination")
	flag.Parse()
	arguments := flag.Args()

	if *output == "" || len(arguments) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: go-perf -o OUTPUT.json EXECUTABLE [ARGUMENTS]")
		os.Exit(2)
	}

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	type counter struct {
		Name                        string
		Config                      uint64
		FD                          int
		Error                       string `json:"error,omitempty"`
		Value, EnabledNS, RunningNS uint64
		Scaled                      float64
	}

	counters := []counter{
		{Name: "cycles", Config: unix.PERF_COUNT_HW_CPU_CYCLES},
		{Name: "instructions", Config: unix.PERF_COUNT_HW_INSTRUCTIONS},
		{Name: "branches", Config: unix.PERF_COUNT_HW_BRANCH_INSTRUCTIONS},
		{Name: "branch-misses", Config: unix.PERF_COUNT_HW_BRANCH_MISSES},
		{Name: "cache-references", Config: unix.PERF_COUNT_HW_CACHE_REFERENCES},
		{Name: "cache-misses", Config: unix.PERF_COUNT_HW_CACHE_MISSES},
	}

	for i := range counters {
		c := &counters[i]

		attr := unix.PerfEventAttr{
			Type: unix.PERF_TYPE_HARDWARE, Config: c.Config,
			Size:        uint32(unsafe.Sizeof(unix.PerfEventAttr{})),
			Bits:        unix.PerfBitDisabled | unix.PerfBitInherit | unix.PerfBitExcludeKernel | unix.PerfBitExcludeHv,
			Read_format: unix.PERF_FORMAT_TOTAL_TIME_ENABLED | unix.PERF_FORMAT_TOTAL_TIME_RUNNING,
		}

		fd, err := unix.PerfEventOpen(&attr, 0, -1, -1, unix.PERF_FLAG_FD_CLOEXEC)
		c.FD = fd

		if err != nil {
			c.Error = err.Error()
			continue
		}

		defer unix.Close(fd)

		if err := unix.IoctlSetInt(fd, unix.PERF_EVENT_IOC_ENABLE, 0); err != nil {
			c.Error = err.Error()
		}
	}

	command := exec.Command(arguments[0], arguments[1:]...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	runError := command.Run()

	for i := range counters {
		c := &counters[i]

		if c.Error != "" {
			continue
		}

		if err := unix.IoctlSetInt(c.FD, unix.PERF_EVENT_IOC_DISABLE, 0); err != nil {
			c.Error = err.Error()
			continue
		}

		var data [24]byte
		count, err := unix.Read(c.FD, data[:])

		if err != nil || count != len(data) {
			c.Error = fmt.Sprintf("counter read: %d bytes, %v", count, err)
			continue
		}

		c.Value = binary.LittleEndian.Uint64(data[:8])
		c.EnabledNS = binary.LittleEndian.Uint64(data[8:16])
		c.RunningNS = binary.LittleEndian.Uint64(data[16:])

		if c.RunningNS > 0 {
			c.Scaled = float64(c.Value) * float64(c.EnabledNS) / float64(c.RunningNS)
		} else {
			c.Error = "counter did not run"
		}
	}

	result := struct {
		Command      []string
		Scope        string
		Counters     []counter
		ProcessUsage *syscall.Rusage `json:",omitempty"`
		Error        string          `json:"error,omitempty"`
	}{Command: arguments, Scope: "user mode, wrapper thread and inherited child tasks; includes setup and warmup", Counters: counters}

	if command.ProcessState != nil {
		result.ProcessUsage, _ = command.ProcessState.SysUsage().(*syscall.Rusage)
	}

	if runError != nil {
		result.Error = runError.Error()
	}

	data, err := json.MarshalIndent(result, "", "  ")

	if err != nil {
		panic(err)
	}

	if err := os.WriteFile(*output, append(data, '\n'), 0o644); err != nil {
		panic(err)
	}

	if runError != nil {
		os.Exit(1)
	}
}
