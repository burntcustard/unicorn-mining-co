import { RemoteMotion } from '../../src/client/remote-motion';
import { GameObject } from '../../src/shared/game-object';
import { addEntity, createWorld } from '../../src/shared/simulation/world';
import * as Vec from '../../src/shared/vector';

// Keep the comparison labels outside production property rewriting.
export const replayHandoff = ([
  speed,
  separation,
  latency,
  fps,
  direction,
]: number[]) => {
  const motion = new RemoteMotion();
  const world = createWorld();
  const local = addEntity(world, new GameObject({ id: 1, radius: 40 }));
  const remote = addEntity(world, new GameObject({ id: 2, radius: 40 }));
  const predicted = createWorld();
  const predictedRemote = addEntity(
    predicted,
    new GameObject({ id: 2, radius: 40 }),
  );
  let last: number | undefined;
  let lastAdvance: number | undefined;
  let maxSpeedRatio = 0;
  let maxSpeedChange = 0;
  let backwards = 0;
  const seconds = 8;
  const origin = (-speed * seconds) / 2;
  const advance = speed / fps;

  for (let frame = 0; frame < seconds * fps; frame++) {
    const now = (frame * 1000) / fps;
    // Both ships travel together vertically. Remote prediction is 100 ms
    // ahead, while the authoritative positions take the downstream delay.

    Vec.set(local.position, Vec.create(0, now * 0.08));
    Vec.set(
      predictedRemote.position,
      Vec.create(
        direction * (origin + speed * (now / 1000 + 0.1)),
        local.position.y + separation,
      ),
    );
    Vec.set(remote.velocity, Vec.create(direction * speed, 80));
    Vec.set(local.velocity, Vec.create(0, 80));

    // The received state trails the predicted pose. Observer distance must
    // never blend these two times or change the apparent passing speed.
    Vec.set(
      remote.position,
      Vec.addScaled(
        predictedRemote.position,
        remote.velocity,
        -(latency / 1000 + 0.1),
      ),
    );
    const position =
      motion.sample({ now, world, predicted, shipId: 1 }).get(2)!.position.x *
      direction;
    const movement = last === undefined ? advance : position - last;

    if (frame > fps && lastAdvance !== undefined) {
      maxSpeedRatio = Math.max(maxSpeedRatio, movement / advance);
      maxSpeedChange = Math.max(
        maxSpeedChange,
        Math.abs(movement - lastAdvance) / advance,
      );

      if (movement < -1e-8) backwards++;
    }
    last = position;
    lastAdvance = movement;
  }
  return {
    speed,
    separation,
    latency,
    fps,
    direction,
    backwards,
    maxSpeedRatio,
    maxSpeedChange,
  };
};
