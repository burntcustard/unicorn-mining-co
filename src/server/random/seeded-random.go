// Port of src/client/utilities/seeded-random.ts.
package random

import "math"

type Random struct{ State float64 }

func CreateRandom(seed float64) *Random { return &Random{State: seed} }
func (r *Random) Next() float64 {
	// Integer seeds and subsequent states have exact float64 products. The
	// constant integer remainder avoids math.Mod's general exponent reduction.
	if r.State >= 0 && r.State <= math.MaxUint32 && r.State == float64(uint64(r.State)) {
		r.State = float64((uint64(r.State) + 1) * 48271 % 2147483647)
	} else {
		r.State = math.Mod((r.State+1)*48271, 2147483647)
	}
	return r.State / 2147483647
}
