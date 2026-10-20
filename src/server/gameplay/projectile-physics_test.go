package gameplay

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestProjectileKeepsMovementLimitsWithoutWakingAsteroidPhysics(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	collisions := NewGameCollisions(catalog)
	world.Collisions = collisions

	asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{
		ObjectProperties: simulation.ObjectProperties{ID: new(int64(1)), Radius: new(100.0)},
		Contents:         []int{1, 1, 1},
		PointCount:       8,
	}).LockGeometry()

	start := Vec.Create(-50, 115)
	shot := objects.NewProjectile("cannonSm", simulation.ObjectProperties{World: world, ID: new(int64(2)), Position: start, Velocity: Vec.Create(10000, 0)}, catalog)
	simulation.AddEntity(world, asteroid)
	simulation.AddEntity(world, shot)
	simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})
	record := collisions.recordFor(asteroid)

	if len(record.Fixtures) != 0 || record.Deferred != asteroid {
		t.Fatal("a fixtureless projectile woke the asteroid's rigid-body geometry")
	}

	if math.Abs(shot.Position.X-start.X-catalog.Simulation.Physics.MaxTranslation) > 1e-6 {
		t.Fatal("the projectile bypassed its normal movement limit")
	}

	shot.Remove()
	probe := simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: new(int64(3)), Position: Vec.Create(0, 100), Radius: new(10.0)}, catalog.Simulation)
	simulation.AddEntity(world, probe)
	simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

	if len(record.Fixtures) == 0 {
		t.Fatal("a real collision body did not wake the deferred asteroid")
	}
}
