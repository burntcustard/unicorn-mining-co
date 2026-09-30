// Port of src/shared/seeded-random.ts.
package random

import "math"

type Random struct{ State float64 }

func CreateRandom(seed float64) *Random { return &Random{State: seed} }
func (r *Random) Next() float64 {
	r.State = math.Mod((r.State+1)*48271, 2147483647)
	return r.State / 2147483647
}
