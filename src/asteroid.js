import { applyForce, pointBetween, rotatePoint } from './vector';
import { objectLineWidth, shapePath } from './drawing';
import { Sprite } from './sprite';
import { colors } from './colors';
import { createPolygon } from './polygon';
import { distribute } from './distribute';
import { outerEdges } from './collisions';
import { rotateAround } from './local-movement';

// An asteroid gives a little, but nothing like a shield does
const asteroidBounciness = 0.1;

// Enough of a wander that no two asteroids come out the same shape
const asteroidVariance = 0.3;

// Next to no drag of its own, so an asteroid coasts where a ship soon slows
const asteroidDrag = 1;

// Five sides keep the old radius-squared mass; fewer sides lose some, more gain some
const massMultiplier = 0.1;

// Fastest an asteroid settles back to on nothing but its starting speed
const asteroidMaxSpeed = 70;
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

  return { x: x / area / 3, y: y / area / 3 };
};

// Boundary edges of a set of outlines, stitched end-to-end into one loop
const outlineFrom = (outlines) => {
  const edges = outlines.flatMap((outline) => outline.flatMap((from, i) =>
    outline.edges[i] ? [[from, outline[(i + 1) % outline.length]]] : []));
  const outline = [edges[0][0]];

  // One edge short of the full loop: the last edge would only re-add the
  // start point, closing the shape back on itself
  for (let i = edges.length - 1; i--;) {
    const at = edges.findIndex(([from]) => from + '' === outline.at(-1) + '');

    outline.push(edges.splice(at, 1)[0][1]);
  }

  return outline;
};

// Sections sharing an edge, regrouped as sections rather than bare outlines
const groupsOf = (sections) => outerEdges(sections.map(({ outline }) => outline))
  .map((indexes) => indexes.map((i) => sections[i]));

// Midpoints quarter each face, leaving four equal triangles per side.
const splitTriangle = (triangle) => {
  const [center, from, to] = triangle;
  const left = pointBetween(center, from);
  const outer = pointBetween(from, to);
  const right = pointBetween(to, center);

  return [[center, left, right], [left, from, outer], [left, outer, right], [outer, to, right]];
};

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);

    this.contents ||= [];
    this.bounciness = asteroidBounciness;
    this.stroke = colors.white[2];
    // Drifts like everything else does, just with next to no drag of its own
    this.drag = asteroidDrag;
    this.maxSpeed = asteroidMaxSpeed;

    // An asteroid doesn't changes shape until split, so its outline is worked out only
    // once. Anything else drifting about out there is the same but cut differently
    this.outline = props.outline || createPolygon({
      points: this.points || pointsFor(this.radius),
      radius: this.radius,
      radiusEven: this.radiusEven,
      variance: this.variance ?? asteroidVariance,
    });
    // Points that wandered outwards reach further than the radius they were
    // cut from, and a collision check has to know about all of them
    const triangles = props.triangles ||
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
    this.path = shapePath(this.outline);

    // A hitbox starts with the complete outline before reaching one of these
    // four-way cuts. The leaves carry health, so each can come free on its own.
    if (!props.triangles) {
      const health = this.health / triangles.length / 4;

      this.sections = triangles.flatMap((triangle) => splitTriangle(triangle).map((outline) => ({
        contents: [],
        health,
        maxHealth: health,
        mass: this.mass / triangles.length / 4,
        outline,
        asteroid: this,
      })));
      groupsOf(this.sections);
    } else if (!triangles[1] && !this.contents.length) {
      this.life = 9 + Math.random();
    }
  }

  split(groups) {
    if (!groups) return [[], this.contents];

    const children = groups.map((sections) => {
      const triangles = sections.map(({ outline }) => outline);
      const mass = sections.reduce((sum, section) => sum + section.mass, 0);
      const contents = sections.flatMap(({ contents }) => contents);

      outerEdges(triangles);
      const outline = outlineFrom(triangles);
      const center = measure(outline);
      const offset = rotatePoint(center, this.rotation);
      const local = ([x, y]) => [(x - center.x), (y - center.y)];
      // Rebase around the child's own centroid without moving any world point
      const child = new Asteroid({
        // The centroid carries the tangential speed it had while the parent
        // rotated, so neither position nor motion jumps at the split
        dx: this.velocity.x - offset.y * this.spin,
        dy: this.velocity.y + offset.x * this.spin,
        contents,
        mass,
        outline: outline.map(local),
        rotation: this.rotation,
        spin: this.spin,
        triangles: triangles.map((triangle) => triangle.map(local)),
        x: this.x + offset.x,
        y: this.y + offset.y,
      });
      const childSections = sections.map((section) => {
        const outline = section.outline.map(local);

        section.contents.forEach(({ buried }) => {
          buried.x -= center.x;
          buried.y -= center.y;
        });

        return Object.assign(section, {
          asteroid: child,
          hitbox: 0,
          outline,
        });
      });

      // A multi-leaf piece remains mineable; one empty loose leaf is short-lived debris.
      if (sections.length > 1) {
        child.sections = childSections;
        groupsOf(child.sections);
      }

      return child;
    });

    const force = 3 / children.reduce((sum, child) => sum + 1 / child.mass, 0);
    const spin = (Math.random() - 0.5) * force / 3;

    children.forEach((child) => applyForce(child,
      child.position.subtract(this.position).normalize().scale(force), spin));

    return [children, []];
  }

  detach(section, destroyed) {
    const loose = destroyed ? section.contents : [];

    if (destroyed) section.contents = [];
    this.sections.splice(this.sections.indexOf(section), 1);

    // What is left is rebuilt fresh through split rather than kept as this
    // same body: a lighter, lopsided remainder needs its own new centre and
    // rotation pivot, and a chance to turn to debris once it is light enough.
    // Grinding away a leaf can also strand the rest across more than one
    // island, touching each other by nothing but a single point
    const islands = groupsOf(this.sections);

    this.sections = [];

    const [children] = this.split([[section], ...islands]);

    return [children, loose];
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
   * Distribute an item through the rock, then snap it to the nearest leaf.
   * A buried item rides with that leaf until a horn cuts it loose.
   *
  * @param {Item} item
  */
  bury(item) {
    distribute([item], { density: 2, width: this.radius }, [...this.contents]);
    const { section, x, y } = this.sections
      .map((section) => ({ section, ...measure(section.outline) }))
      .sort((a, b) => item.position.distance(a) - item.position.distance(b))[0];

    Object.assign(item, item.buried = { rotation: Math.random() * Math.PI * 2, x, y });
    section.contents.push(item);
    this.contents.push(item);
  }

  /**
   * @param {Number} dt - Seconds since the last update.
   */
  update(dt, items) {
    if (this.life && (this.life -= dt) <= 0) this.dead = true;
    this.contents.forEach((item) => {
      const { buried } = item;

      Object.assign(item, buried);
      rotateAround(this, item, buried.x, buried.y, this.rotation);

      if (this.dead) {
        item.velocity.set(this.velocity);
        item.arm();
        items.push(item);
      }
    });
  }

  render() {
    const { ctx } = this;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.lineWidth = objectLineWidth;
    ctx.lineJoin = 'round';
    ctx.fillStyle = colors.black[2];
    ctx.strokeStyle = this.stroke;
    ctx.fill(this.path);
    ctx.stroke(this.path);
    ctx.restore();
  }
}
