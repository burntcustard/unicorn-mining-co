import { Sprite } from './sprite';
import { colors } from './colors';
import { createPolygon } from './polygon';
import { distribute } from './distribute';
import { outerEdges } from './collisions';
import { rotateAround } from './local-movement';
import { rotatePoint } from './vector';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// An asteroid gives a little, but nothing like a shield does
const asteroidBounciness = 0.2;

// Enough of a wander that no two asteroids come out the same shape
const asteroidVariance = 0.3;

// Next to no drag of its own, so an asteroid coasts where a ship soon slows
const asteroidDrag = 1;

// Fastest an asteroid settles back to on nothing but its starting speed
const asteroidMaxSpeed = 70;
// Small triangles detach whole; this is the least health needed to crack again
const minSplitHealth = 80;

// Bigger asteroids need more points to be lumpy with
const pointsFor = (radius) => Math.round(Math.sqrt(radius) / 3) * 2 - 1;

// Signed-edge sums give both exact polygon area and its physical centre
const measure = (points) => {
  let area = 0;
  let x = 0;
  let y = 0;

  points.forEach(([atX, atY], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length];
    const cross = atX * nextY - nextX * atY;

    area += cross;
    x += (atX + nextX) * cross;
    y += (atY + nextY) * cross;
  });

  return [x / area / 3, y / area / 3];
};

const inside = ([x, y], triangle) => triangle.every(([fromX, fromY], i) => {
  const [toX, toY] = triangle[(i + 1) % triangle.length];

  return (toX - fromX) * (y - fromY) - (toY - fromY) * (x - fromX) >= 0;
});
const outlineOf = (triangles) => [
  triangles[0][0],
  triangles[0][1],
  ...triangles.map((triangle) => triangle[2]),
];

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);

    this.bounciness = asteroidBounciness;
    this.stroke = colors.white[2];
    // Drifts like everything else does, just with next to no drag of its own
    this.drag = asteroidDrag;
    this.maxSpeed = asteroidMaxSpeed;

    // An asteroid never changes shape, so its outline is worked out only once.
    // Anything else drifting about out there is the same but cut differently
    this.outline = props.outline || createPolygon({
      points: this.points || pointsFor(this.radius),
      radius: this.radius,
      radiusEven: this.radiusEven,
      variance: this.variance ?? asteroidVariance,
    });
    // Points that wandered outwards reach further than the radius they were
    // cut from, and a collision check has to know about all of them
    this.triangles = props.triangles || this.outline.map((point, i) => [
      [0, 0],
      point,
      this.outline[(i + 1) % this.outline.length],
    ]);
    this.radius = Math.max(...this.outline.map(([x, y]) => Math.hypot(x, y)));
    // Heft grows with size, so a big asteroid shrugs off what shoves a pebble and
    // holds its drift far longer
    this.mass = this.radius ** 2;
    this.health = this.radius * 2;
    this.maxHealth = this.health;
    this.path = shapePath(this.outline);
  }

  divide(target, pieces) {
    const divisor = target === this ? pieces.length : 2;
    const sections = pieces.map((triangles) => {
      const health = target.maxHealth * triangles.length / divisor;
      const outline = outlineOf(triangles);

      return {
        health,
        maxHealth: health,
        outline,
        path: shapePath(outline),
        radius: Math.max(...outline.map(([x, y]) => Math.hypot(x, y))),
        asteroid: this,
        triangles,
      };
    });

    if (target === this) {
      this.sections = sections;
    } else {
      this.sections.splice(this.sections.indexOf(target), 1, ...sections);
    }

    outerEdges(this.sections.map(({ outline }) => outline));
    return sections;
  }

  crack(target, x, y) {
    if (target !== this) {
      if (target.triangles.length > 1) {
        this.divide(target, target.triangles.map((triangle) => [triangle]));
      } else if (target.maxHealth >= minSplitHealth) {
        const center = measure(target.outline);
        this.divide(target, target.outline.map((point, i) => {
          const next = target.outline[(i + 1) % target.outline.length];
          const middle = point.map((value, axis) => (value + next[axis]) / 2);

          return [[center, point, middle], [center, middle, next]];
        }));
      }

      return;
    }

    const sides = target.outline.length;

    if (sides < 4 || this.sections) return;

    const point = rotatePoint({ x: x - this.x, y: y - this.y }, -this.rotation);
    let start = 0;
    let nearest = Infinity;

    this.triangles.forEach((triangle, i) => {
      const distance = Math.hypot(point.x - triangle[1][0], point.y - triangle[1][1]);

      if (distance < nearest) [nearest, start] = [distance, i];
    });

    // Start at the mined corner and spread the centre-fan triangles evenly
    // across three sections
    const triangles = [...this.triangles.slice(start), ...this.triangles.slice(0, start)];
    const sizes = Array(3).fill(1);

    for (let i = 3; i < triangles.length; i++) sizes[i % 3]++;

    let at = 0;
    const pieces = sizes.map((size) => triangles.slice(at, at += size));

    this.divide(target, pieces);
  }

  split(groups) {
    if (!groups) return [[], this.contents || []];

    const children = groups.map((sections) => {
      const triangles = sections.flatMap(({ triangles }) => triangles);

      const outline = outlineOf(triangles);
      const [centerX, centerY] = measure(outline);
      const offset = rotatePoint({ x: centerX, y: centerY }, this.rotation);
      const radius = Math.max(...outline.map(([x, y]) => Math.hypot(x - centerX, y - centerY)));
      const scale = 1 - lineWidth / radius;
      const local = ([x, y]) => [(x - centerX) * scale, (y - centerY) * scale];
      // Rebase around the child's own centroid without moving any world point
      const child = new Asteroid({
        // The centroid carries the tangential speed it had while the parent
        // rotated, so neither position nor motion jumps at the split
        dx: this.velocity.x - offset.y * this.spin,
        dy: this.velocity.y + offset.x * this.spin,
        outline: outline.map(local),
        rotation: this.rotation,
        spin: this.spin,
        triangles: triangles.map((triangle) => triangle.map(local)),
        x: this.x + offset.x,
        y: this.y + offset.y,
      });

      if (sections.length > 1) {
        child.sections = sections.map((section) => {
          const outline = section.outline.map(local);

          return Object.assign(section, {
            asteroid: child,
            hitbox: 0,
            outline,
            path: shapePath(outline),
            radius: Math.max(...outline.map(([x, y]) => Math.hypot(x, y))),
            triangles: section.triangles.map((triangle) => triangle.map(local)),
          });
        });
        outerEdges(child.sections.map(({ outline }) => outline));
      }

      child.fromParent = [centerX, centerY];
      return child;
    });
    const kept = [];

    this.contents?.forEach((item) => {
      const point = rotatePoint({ x: item.x - this.x, y: item.y - this.y }, -this.rotation);
      const child = children.find((part) => {
        const local = [point.x - part.fromParent[0], point.y - part.fromParent[1]];

        return part.triangles.some((triangle) => inside(local, triangle));
      });

      if (!child) {
        kept.push(item);
      } else {
        const x = point.x - child.fromParent[0];
        const y = point.y - child.fromParent[1];

        (child.contents ||= []).push(item);
        item.buried = { rotation: item.rotation - child.rotation, x, y };
      }
    });
    this.contents = kept;

    return [children, []];
  }

  detach(section) {
    const sections = this.sections.filter((part) => part !== section);
    const groups = outerEdges(sections.map(({ outline }) => outline));

    this.sections = (groups.shift() || []).map((i) => sections[i]);
    const detached = [
      [section],
      ...groups.map((group) => group.map((i) => sections[i])),
    ];

    return this.split(detached);
  }

  hitboxes() {
    return (this.sections || [this]).map((segment) => Object.assign(
      segment.hitbox ||= { owner: this, segment }, {
        bounciness: this.bounciness,
        outline: segment.outline,
        radius: segment.radius,
        rotation: this.rotation,
        stroke: this.stroke,
        x: this.x,
        y: this.y,
      }));
  }

  /**
   * Tuck an item away in the heart of the asteroid. Everything buried starts at
   * the middle and is settled against its other finds. A buried item rides along
   * with the asteroid until a horn grinds it open.
   *
  * @param {Item} item
  */
  bury(item) {
    this.contents = distribute([item], {
      density: 2,
      width: this.radius,
    }, this.contents);
    this.contents.forEach((content) => {
      content.buried ||= { rotation: Math.random() * Math.PI * 2 };
      Object.assign(content.buried, { x: content.x, y: content.y });
    });
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update() {
    this.contents?.forEach((item) => {
      const { buried } = item;

      Object.assign(item, buried);
      rotateAround(this, item, buried.x, buried.y, this.rotation);
    });
  }

  render() {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineJoin = 'bevel';
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = colors.black[2];
    ctx.strokeStyle = this.stroke;
    (this.sections || [this]).forEach(({ path }) => {
      ctx.fill(path);
      ctx.stroke(path);
    });

    ctx.restore();
  }
}
