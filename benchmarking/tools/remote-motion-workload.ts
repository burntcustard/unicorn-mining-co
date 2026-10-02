import { RemoteMotion } from '../../src/client/remote-motion';
import { GameObject } from '../../src/shared/game-object';
import { addEntity, createWorld } from '../../src/shared/simulation/world';
import type { ReplicatedEntity } from '../../src/shared/protocol/network';
import * as Vec from '../../src/shared/vector';

// Positional settings cross the unmangled Node driver/production bundle boundary.
export const motionFixture = ([players, scenario, seconds = 30]: [
  number,
  string,
  number?,
]) => {
  const world = createWorld();
  const entities = Array.from({ length: players + 32 }, (_, index) =>
    addEntity(
      world,
      new GameObject({
        id: index + 1,
        radius: 10,
        position: Vec.create(index ? 1000 + index * 10 : 0, index * 20),
        velocity: Vec.create(index < players ? 120 : 0, 0),
      }),
    ),
  );
  const entityIds = entities.map((entity) => entity.id);
  const packets: { at: number; tick: number; entities: ReplicatedEntity[] }[] =
    [];
  let previous = -Infinity;
  let seed = 25;
  const interval = scenario === 'slow' ? 3 : 1;

  for (let tick = 0; tick <= seconds * 30; tick += interval) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    const random = (seed >>> 0) / 2 ** 32;
    let delay = 40;

    if (scenario === 'jitter') delay += random * 55;

    if (scenario === 'burst') delay += tick % 12 === 0 ? 90 : random * 8;

    if (scenario === 'outage' && tick >= 300 && tick < 330) {
      delay += ((330 - tick) * 1000) / 30;
    }
    const at = Math.max(previous + 0.001, (tick * 1000) / 30 + delay);

    previous = at;
    packets.push({
      at,
      tick,
      entities: entities
        .filter((_, i) => tick === 0 || i < players)
        .map((entity) => ({
          id: entity.id,
          kind: 'object',
          position: Vec.addScaled(entity.position, entity.velocity, tick / 30),
          rotation: tick * 0.002,
          radius: entity.radius,
          spin: 0,
        })),
    });
  }
  return { world, entityIds, packets, seconds };
};

export const replayMotion = (
  fixture: ReturnType<typeof motionFixture>,
  quality = false,
) => {
  const motion = new RemoteMotion();
  const moving = [...fixture.world.entities.values()].filter(
    (entity) => entity.velocity.x,
  );
  let last = NaN,
    stalls = 0,
    backwards = 0,
    samples = 0,
    lag = 0,
    maxLagMs = 0,
    roughness = 0,
    previousSpeed = 120,
    checksum = 0;

  for (let frame = 0; frame < fixture.seconds * 60; frame++) {
    const now = (frame * 1000) / 60;

    // This microbenchmark measures sampling already-predicted poses.
    // Network delay and packet bursts are covered by remote-perspectives.
    moving.forEach((entity, index) => {
      entity.position.x = (index ? 1000 + index * 10 : 0) + now * 0.12;
    });

    const pose = motion.sample({ now, world: fixture.world, shipId: 1 }).get(2);

    if (!pose) continue;
    checksum += pose.position.x;

    if (quality && frame > 300 && Number.isFinite(last)) {
      const distance = pose.position.x - last;
      const speed = distance * 60;

      if (Math.abs(distance) < 1e-8) stalls++;

      if (distance < -1e-8) backwards++;
      const lagMs = now - ((pose.position.x - 1010) / 120) * 1000;

      lag += lagMs;
      maxLagMs = Math.max(maxLagMs, lagMs);
      roughness += Math.abs(speed - previousSpeed);
      previousSpeed = speed;
      samples++;
    }
    last = pose.position.x;
  }
  return {
    checksum,
    stalls,
    backwards,
    meanLagMs: lag / samples,
    meanSpeedChange: roughness / samples,
    maxLagMs,
  };
};
