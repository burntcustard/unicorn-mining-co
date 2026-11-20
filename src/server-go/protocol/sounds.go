package protocol

import Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"

type WorldSound struct {
	Effect   byte
	ID, By   int64
	Position Vec.Vector
}
