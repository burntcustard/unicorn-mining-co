package network

import (
	"math/rand/v2"
	"strings"
)

/*
dialogText picks once before broadcasting, so every recipient sees the same variant.
Speech uses its own randomness without advancing the simulation's random state.
*/
func dialogText(lines []string, replacements ...string) string {
	if len(lines) == 0 {
		return ""
	}

	return strings.NewReplacer(replacements...).Replace(lines[rand.IntN(len(lines))])
}
