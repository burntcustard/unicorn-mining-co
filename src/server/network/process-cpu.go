package network

import "syscall"

// processCPUSeconds returns user plus system CPU time for this process.
func processCPUSeconds() float64 {
	var usage syscall.Rusage

	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) != nil {
		return 0
	}

	return float64(usage.Utime.Sec) + float64(usage.Utime.Usec)/1e6 + float64(usage.Stime.Sec) + float64(usage.Stime.Usec)/1e6
}
