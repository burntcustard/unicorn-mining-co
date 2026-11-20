package utilities

import (
	"os"
	"strings"
)

/*
 * Select independent SIMD pipelines at process startup for controlled benchmarks.
 * An empty setting enables all available pipelines; "scalar" disables them.
 */
func SIMDFeature(feature string) bool {
	setting := os.Getenv("GO_SERVER_SIMD")
	return setting == "" || setting == "all" || strings.Contains(","+setting+",", ","+feature+",")
}
