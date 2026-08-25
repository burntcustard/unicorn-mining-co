import { Vector, rotatePoint } from './vector';
import { Sprite } from './sprite';
import { colors } from './colors';
import { createPolygon } from './polygon';
import { distribute } from './distribute';
import { outerEdges } from './collisions';
import { rotateAround } from './local-movement';
import { shapePath } from './drawing';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// An asteroid gives a little, but nothing like a shield does
const asteroidBounciness = 0.1;

// Enough of a wander that no two asteroids come out the same shape
const asteroidVariance = 0.3;

// Next to no drag of its own, so an asteroid coasts where a ship soon slows
const asteroidDrag = 1;

// Used to shrink down mass to align with small numbers for the rest of the game
const massMultiplier = 0.2;

// Fastest an asteroid settles back to on nothing but its starting speed
const asteroidMaxSpeed = 70;
// Below this, a detached triangle is debris rather than another mineable rock
const minTriangleMass = 100;
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
// Follow the exposed edges instead of assuming the triangles are still a fan.

const outlineOf = (triangles) => {
  outerEdges(triangles);
  const edges = triangles.flatMap((triangle) => triangle.flatMap((from, i) =>
    triangle.edges[i] ? [[from, triangle[(i + 1) % triangle.length]]] : []));
  const outlines = [];

  while (edges.length) {
    const [start, next] = edges.shift();
    const outline = [start];
    let to = next;

    while (to + '' !== start + '') {
      outline.push(to);
      const at = edges.findIndex(([from]) => from + '' === to + '');

      if (at < 0) break;
      [, to] = edges.splice(at, 1)[0];
    }

    outlines.push(outline);
  }

  return outlines.sort((a, b) => b.length - a.length)[0];
};

// Sections sharing an edge, regrouped as sections rather than bare outlines
const groupsOf = (sections) => outerEdges(sections.map(({ outline }) => outline))
  .map((indexes) => indexes.map((i) => sections[i]));

// Midpoints quarter each face, leaving four equal triangles per side.
const splitTriangle = (triangle) => {
  const middle = (from, to) => from.map((value, axis) => (value + to[axis]) / 2);
  const [center, from, to] = triangle;
  const left = middle(center, from);
  const outer = middle(from, to);
  const right = middle(to, center);

  return [[center, left, right], [left, from, outer], [left, outer, right], [outer, to, right]];
};

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
    this.triangles = props.triangles ||
      (this.outline[3] ?
          this.outline.map((point, i) => [
            [0, 0],
            point,
            this.outline[(i + 1) % this.outline.length],
          ]) :
          [this.outline]);
    this.radius = Math.max(...this.outline.map(([x, y]) => Math.hypot(x, y)));
    // Heft grows with size, so a big asteroid shrugs off what shoves a pebble and
    // holds its drift far longer
    this.mass = props.mass || massMultiplier * this.radius ** 2;
    this.health = this.radius * 2;
    this.maxHealth = this.health;
    this.path = shapePath(this.outline);

    // A hitbox still starts with the complete outline, then its parent face,
    // before it reaches one of these four-way cuts.  The leaves are what carry
    // health, so one can be detached without opening a crack through the rest.
    if ((!props.triangles || !this.triangles[1]) && this.mass >= minTriangleMass) {
      const health = this.maxHealth / this.triangles.length / 4;

      this.sections = this.triangles.flatMap((triangle) => splitTriangle(triangle).map((outline) => ({
        health,
        maxHealth: health,
        mass: this.mass / this.triangles.length / 4,
        outline,
        path: shapePath(outline),
        asteroid: this,
        triangle,
        triangles: [outline],
      })));
      groupsOf(this.sections);
    } else if (props.triangles && !this.triangles[1]) {
      this.life = 3 + Math.random();
    }
  }

  crack(target) {
    if (target !== this) {
      // The caller removes this leaf from the world immediately.  `crack`
      // remains the threshold hook used by mining, but no longer changes the
      // mesh: it was all cut when the asteroid was made.
      return target;
    }
  }

  split(groups) {
    if (!groups) return [[], this.contents || []];

    // A group can still be more than one island touching only at a point;
    // outlineOf assumes a single loop, so nothing reaches it still joined
    // by nothing but a shared corner
    const clusters = groups.flatMap(groupsOf);

    const masses = clusters.map((sections) =>
      sections.reduce((sum, section) => sum + section.mass, 0));
    // Momentum stays roughly where it was: a crumb coming off a mountain
    // takes almost all of the kick, and the mountain barely feels it
    const totalMass = masses.reduce((sum, mass) => sum + mass, 0) || 1;

    const children = clusters.map((sections, i) => {
      const triangles = sections.flatMap(({ triangles }) => triangles);
      const mass = masses[i];
      const kickRatio = 1 - mass / totalMass;

      const outline = outlineOf(triangles);
      const [centerX, centerY] = measure(outline);
      const offset = rotatePoint({ x: centerX, y: centerY }, this.rotation);
      const local = ([x, y]) => [(x - centerX), (y - centerY)];
      // Rebase around the child's own centroid without moving any world point
      const child = new Asteroid({
        // The centroid carries the tangential speed it had while the parent
        // rotated, so neither position nor motion jumps at the split
        dx: this.velocity.x - offset.y * this.spin,
        dy: this.velocity.y + offset.x * this.spin,
        mass,
        outline: outline.map(local),
        rotation: this.rotation,
        spin: this.spin,
        triangles: triangles.map((triangle) => triangle.map(local)),
        x: this.x + offset.x,
        y: this.y + offset.y,
      });
      child.velocity.set(child.velocity.add(Vector(offset).normalize().scale(3 * kickRatio)));
      child.spin += (Math.random() * 0.5 - 0.25) * kickRatio;

      // Still more than one leaf makes this a rock to keep mining regardless
      // of what its remaining mass adds up to; only a lone leaf is judged
      // against minTriangleMass, since that is what "detached" ever meant
      if (sections.length > 1) {
        child.sections = sections.map((section) => {
          const outline = section.outline.map(local);

          return Object.assign(section, {
            asteroid: child,
            hitbox: 0,
            outline,
            path: shapePath(outline),
            triangle: section.triangle.map(local),
            triangles: section.triangles.map((triangle) => triangle.map(local)),
          });
        });
        groupsOf(child.sections);
      } else if (mass < minTriangleMass) {
        child.life ||= 3 + Math.random();
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
    this.sections.splice(this.sections.indexOf(section), 1);

    // What is left is rebuilt fresh through split rather than kept as this
    // same body: a lighter, lopsided remainder needs its own new centre and
    // rotation pivot, and a chance to turn to debris once it is light enough.
    // Grinding away a leaf can also strand the rest across more than one
    // island, touching each other by nothing but a single point
    const islands = groupsOf(this.sections);

    this.sections = [];

    return this.split([[section], ...islands]);
  }

  hitboxes() {
    // Keep one body in the world grid.  `parts` is only inspected after this
    // body's radius and complete outline have already overlapped something.
    return [Object.assign(this.hitbox ||= { owner: this }, {
      bounciness: this.bounciness,
      outline: this.outline,
      parts: this.sections,
      segment: this.sections ? undefined : this,
      radius: this.radius,
      rotation: this.rotation,
      stroke: this.stroke,
      x: this.x,
      y: this.y,
    })];
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
  update(dt) {
    if (this.life && (this.life -= dt) <= 0) this.dead = true;
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
    const pieces = this.sections || [this];

    pieces.forEach(({ path }) => {
      ctx.fill(path);
    });

    if (pieces[0].outline.edges) {
      // Overlapping square caps hide joins between boundary edges, while the
      // one stroke leaves every internal mesh edge invisible.
      ctx.lineCap = 'round';
      ctx.beginPath();

      pieces.forEach(({ outline }) => outline.forEach((from, i) => {
        if (!outline.edges[i]) return;

        ctx.moveTo(...from);
        ctx.lineTo(...outline[(i + 1) % outline.length]);
      }));

      ctx.stroke();
    } else {
      ctx.stroke(this.path);
    }

    ctx.restore();
  }
}
