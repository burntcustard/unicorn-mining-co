import { colors } from '../../specs/colors';
import { linearSlop } from '../../specs/physics';
import { AABB } from '../collision/axis-aligned-bounds';
import { Manifold, WorldManifold } from '../collision/contact-manifold';
import { collideCircles } from '../collision/shape/circle-circle-contact';
import { collidePolygonCircle } from '../collision/shape/circle-polygon-contact';
import { CircleShape } from '../collision/shape/circle-shape';
import { PolygonShape } from '../collision/shape/polygon-shape';
import { SpatialGrid, type SpatialProxy } from '../collision/spatial-grid';
import type { Craft } from '../objects/craft';
import type { GameObject } from '../objects/game-object';
import type { Pose, ShapeOutline } from '../types';
import { createPath } from '../utilities/drawing-path';
import { rotatePoint } from '../utilities/geometry';
import * as Vec from '../utilities/vector';
import { transform } from '../utilities/vector-math';

const length = 3.5;
const width = 2.5;
const radius = width / 2;
const fadeDuration = 100;
const muzzleClearance = 70;

type Shell = Pose & {
  parent?: Craft;
  ownerId: number;
  velocity: Vec.Value;
  spin: number;
  age: number;
  duration: number;
};

type Surface = {
  body: Body;
  shape: CircleShape | PolygonShape;
  transform: ReturnType<typeof transform>;
  bounds: AABB;
};

type Body = {
  object: GameObject;
  pose: Pose;
  surfaces?: Surface[];
  frame: number;
};

const shells: Shell[] = [];
const spareShells: Shell[] = [];
const bodies = new Map<number, SpatialProxy<Body>>();
let grid = new SpatialGrid<Body>();
const polygons = new WeakMap<ShapeOutline, PolygonShape>();
const box = new AABB();
const noDisplacement = Vec.create();
const circle = new CircleShape(Vec.create(), radius);
const shellTransform = transform(0, 0, 0);
const manifold = new Manifold();
const worldManifold = new WorldManifold();
const nearby: Surface[] = [];
let frame = 0;
let path: Path2D | undefined;

export const ejectAutogunShell = ({
  craft,
  position,
  rotation,
  side,
}: {
  craft: Craft;
  position: Vec.Value;
  rotation: number;
  side: number;
}) => {
  const shell: Shell = spareShells.pop() ?? {
    position: Vec.create(),
    velocity: Vec.create(),
    rotation: 0,
    spin: 0,
    age: 0,
    duration: 0,
    ownerId: 0,
  };

  const direction = rotation + side * (1.7 + Math.random() * 0.35);
  const speed = 95 + Math.random() * 40;

  shell.parent = craft;
  shell.ownerId = craft.id;
  Vec.set(shell.position, position);
  Vec.setXY(
    shell.velocity,
    Math.cos(direction) * speed,
    Math.sin(direction) * speed,
  );
  shell.rotation = rotation + (Math.random() - 0.5) * 0.5;
  shell.spin = side * (4 + Math.random() * 6);
  shell.age = 0;
  shell.duration = 500 + Math.random() * 500;
  shells.push(shell);
};

const syncBodies = (
  objects: readonly GameObject[],
  poses?: ReadonlyMap<number, Pose>,
) => {
  frame++;

  for (const object of objects) {
    if (object.dead || object.buried || !object.physics || !object.radius) {
      continue;
    }

    const pose = poses?.get(object.id) || object;
    const { x, y } = pose.position;
    const { radius } = object;
    const proxy = bodies.get(object.id);

    Vec.setXY(box.lowerBound, x - radius, y - radius);
    Vec.setXY(box.upperBound, x + radius, y + radius);

    if (proxy) {
      grid.moveProxy(proxy, box, noDisplacement);
      proxy.userData.object = object;
      proxy.userData.pose = pose;
      proxy.userData.frame = frame;
      proxy.userData.surfaces = undefined;
    } else {
      bodies.set(
        object.id,
        grid.createProxy(box, { object, pose, frame }, object.id),
      );
    }
  }

  for (const [id, proxy] of bodies) {
    if (proxy.userData.frame === frame) continue;
    grid.destroyProxy(proxy);
    bodies.delete(id);
  }
};

const surfacesOf = (body: Body) => {
  const { object, pose } = body;
  const surfaces: Surface[] = [];
  const angle = pose.rotation - object.rotation;

  for (const collider of object.hitbox()) {
    if (collider.physics === false || collider.pickupPoint) continue;

    const { shapeOutline: outline, collisionMargin = 2 * linearSlop } =
      collider;
    let shape: Surface['shape'];

    if (outline?.length) {
      shape = polygons.get(outline)!;

      if (!shape || shape.m_radius !== collisionMargin) {
        shape = new PolygonShape(
          outline.map(([x, y]) => Vec.create(x, y)),
          collisionMargin,
        );

        if (Object.isFrozen(outline)) polygons.set(outline, shape);
      }
    } else {
      shape = new CircleShape(Vec.create(), collider.radius);
    }

    const position = Vec.add(
      pose.position,
      rotatePoint(Vec.subtract(collider.position, object.position), angle),
    );
    const placement = transform(
      position.x,
      position.y,
      collider.rotation + angle,
    );
    const bounds = new AABB();

    shape.computeAABB(bounds, placement);
    AABB.extend(bounds, radius);
    surfaces.push({ body, shape, transform: placement, bounds });
  }

  return surfaces;
};

const moveShell = (shell: Shell, dt: number) => {
  const { position, velocity } = shell;
  const travel = Vec.length(velocity) * dt;
  const reach = travel + radius;

  Vec.setXY(box.lowerBound, position.x - reach, position.y - reach);
  Vec.setXY(box.upperBound, position.x + reach, position.y + reach);
  nearby.length = 0;

  grid.query(box, ({ userData: body }) => {
    if (shell.age < muzzleClearance && body.object.id === shell.ownerId) {
      return true;
    }

    for (const surface of (body.surfaces ??= surfacesOf(body))) {
      if (AABB.testOverlap(box, surface.bounds)) nearby.push(surface);
    }

    return true;
  });

  // Use small steps near a surface so the light shell can hit thin parts.
  const steps = nearby.length
    ? Math.min(16, Math.max(1, Math.ceil(travel / radius)))
    : 1;

  for (let i = 0; i < steps; i++) {
    Vec.addScaled(position, velocity, dt / steps, position);

    for (const { body, shape, transform, bounds } of nearby) {
      const { lowerBound, upperBound } = bounds;

      if (
        position.x < lowerBound.x ||
        position.x > upperBound.x ||
        position.y < lowerBound.y ||
        position.y > upperBound.y
      ) {
        continue;
      }

      Vec.set(shellTransform.p, position);

      if (shape instanceof PolygonShape) {
        collidePolygonCircle(
          manifold,
          shape,
          transform,
          circle,
          shellTransform,
        );
      } else {
        collideCircles(manifold, shape, transform, circle, shellTransform);
      }

      if (!manifold.pointCount) continue;

      const { normal, points, separations } = manifold.getWorldManifold(
        worldManifold,
        transform,
        shape.m_radius,
        shellTransform,
        radius,
      );
      const { object, pose } = body;
      const surfaceX =
        object.velocity.x - object.spin * (points[0].y - pose.position.y);
      const surfaceY =
        object.velocity.y + object.spin * (points[0].x - pose.position.x);
      const approach =
        (velocity.x - surfaceX) * normal.x + (velocity.y - surfaceY) * normal.y;

      Vec.addScaled(
        position,
        normal,
        Math.max(0, -separations[0]) + 0.01,
        position,
      );

      if (approach >= 0) continue;
      Vec.addScaled(velocity, normal, -approach * 1.45, velocity);
      shell.spin *= -0.7;
    }
  }

  shell.rotation += shell.spin * dt;
};

export const clearAutogunShells = () => {
  for (const shell of shells) {
    shell.parent = undefined;
    spareShells.push(shell);
  }

  shells.length = nearby.length = 0;

  if (bodies.size) {
    bodies.clear();
    grid = new SpatialGrid();
  }
};

export const renderAutogunShells = ({
  ctx,
  dt,
  objects,
  poses,
  view,
}: {
  ctx: CanvasRenderingContext2D;
  dt: number;
  objects: readonly GameObject[];
  poses?: ReadonlyMap<number, Pose>;
  view: { position: Vec.Value; width: number; height: number };
}) => {
  if (!shells.length) return;
  syncBodies(objects, poses);

  ctx.save();
  ctx.fillStyle = colors.yellow[2];
  const opacity = ctx.globalAlpha;

  for (let index = shells.length; index--;) {
    const shell = shells[index];
    const { parent, position } = shell;

    if (parent) {
      const pose = poses?.get(parent.id) || parent;
      const velocity =
        bodies.get(parent.id)?.userData.object.velocity ?? parent.velocity;

      Vec.add(pose.position, rotatePoint(position, pose.rotation), position);
      Vec.add(
        velocity,
        rotatePoint(shell.velocity, pose.rotation),
        shell.velocity,
      );
      shell.rotation += pose.rotation;
      shell.parent = undefined;
    } else if ((shell.age += dt) < shell.duration) {
      moveShell(shell, dt / 1000);
    } else {
      shells[index] = shells.at(-1)!;
      shells.pop();
      spareShells.push(shell);
      continue;
    }

    if (
      position.x + length < view.position.x ||
      position.x - length > view.position.x + view.width ||
      position.y + length < view.position.y ||
      position.y - length > view.position.y + view.height
    ) {
      continue;
    }

    if (!path) {
      path = createPath();
      path.rect(-length / 2, -width / 2, length, width);
    }

    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(shell.rotation);
    ctx.globalAlpha =
      opacity * Math.min(1, (shell.duration - shell.age) / fadeDuration);
    ctx.fill(path);
    ctx.restore();
  }

  ctx.restore();

  if (!shells.length) clearAutogunShells();
};
