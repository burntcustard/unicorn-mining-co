import {
  TOIInput,
  TOIOutput,
  TOIOutputState,
  TimeOfImpact,
} from './collision/TimeOfImpact';
import { type Fixture } from './dynamics/Fixture';
import { type Body } from './dynamics/Body';
import { type GameObject } from '../game-object';
import { type Contact, type Collider } from './collision/types';
import { Vector } from '../vector';
import { physicsScale } from './game-settings';
import { testOverlap } from './collision/Distance';
import { Transform } from './common/Transform';
import { CircleShape } from './collision/shape/CircleShape';

/*
 * Sensor casts use the same swept transforms as physical bodies, but report
 * gameplay contacts without stopping either body or applying an impulse.
 */
export const sweepSensors = ({
  records,
  previous,
}: {
  records: { body: Body; entity: GameObject; fixtures: Fixture[] }[];
  previous: Map<number, { position: Vector; rotation: number }>;
}) => {
  const contacts: Contact[] = [];
  records.forEach((a) =>
    a.fixtures
      .filter((fixture) => fixture.isSensor())
      .forEach((sensor) => {
        const collider = sensor.getUserData() as Collider;
        if (!collider.role && !collider.dockSegment) return;
        const fromA = previous.get(a.entity.id) || a.entity;
        records.forEach((b) => {
          if (a === b) return;
          const fromB = previous.get(b.entity.id) || b.entity;
          const travel =
            a.entity.position.distanceTo(fromA.position) +
            b.entity.position.distanceTo(fromB.position);
          const sensorReach =
            collider.position.distanceTo(a.entity.position) + collider.radius;
          if (
            a.entity.position.distanceTo(b.entity.position) >
            sensorReach + b.entity.radius + travel
          )
            return;
          b.fixtures
            .filter((fixture) => !fixture.isSensor())
            .forEach((target) => {
              const input = new TOIInput();
              // Cargo is caught when its centre enters the throat, not when an edge
              // grazes it. Using a point also records a crossing between endpoints.
              const targetShape =
                collider.role === 'scoop'
                  ? new CircleShape(0)
                  : target.getShape();
              input.proxyA.set(sensor.getShape(), 0);
              input.proxyB.set(targetShape, 0);
              for (const [sweep, record, from] of [
                [input.sweepA, a, fromA],
                [input.sweepB, b, fromB],
              ] as const) {
                sweep.c0.set(from.position.scale(physicsScale));
                sweep.c.set(record.entity.position.scale(physicsScale));
                sweep.a0 = from.rotation;
                sweep.a = record.entity.rotation;
              }
              input.tMax = 1;
              const output = new TOIOutput();
              TimeOfImpact(output, input);
              const overlap =
                testOverlap(
                  sensor.getShape(),
                  0,
                  targetShape,
                  0,
                  new Transform(
                    fromA.position.scale(physicsScale),
                    fromA.rotation,
                  ),
                  new Transform(
                    fromB.position.scale(physicsScale),
                    fromB.rotation,
                  ),
                ) ||
                testOverlap(
                  sensor.getShape(),
                  0,
                  targetShape,
                  0,
                  a.body.getTransform(),
                  b.body.getTransform(),
                );
              if (
                !overlap &&
                output.state !== TOIOutputState.e_touching &&
                output.state !== TOIOutputState.e_overlapped
              )
                return;
              contacts.push({
                collider,
                other: target.getUserData() as Collider,
                depth: 0.01,
                swept: true,
                normal: b.entity.position
                  .subtract(a.entity.position)
                  .normalize(),
                point: collider.position,
              });
            });
        });
      }),
  );
  return contacts;
};
