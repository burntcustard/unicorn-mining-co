import { Vector, rotatePoint } from 'kontra';
import { linesPath, shapePath } from './drawing';
import { Sprite } from './sprite';
import { colors } from './colors';
import { createPolygon } from './polygon';
import { distribute } from './distribute';
import { rotateAround } from './local-movement';

// Stroke width in game units, to match the ships
const lineWidth = 3;

// Rock gives a little, but nothing like a shield does
const rockBounciness = 0.2;

// Enough of a wander that no two rocks come out the same shape
const rockVariance = 0.3;

// Next to no drag of its own, so a rock coasts on where a ship soon slows
const rockDrag = 1;

// Fastest a rock settles back to on nothing but the speed it was given
const rockMaxSpeed = 70;

// Bigger rocks need more points to be lumpy with
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

const distanceTo = (point, [from, to]) => {
  const start = Vector(...from);
  const along = Vector(...to).subtract(start);
  const position = Vector(point);
  const at = Math.max(0, Math.min(1,
    position.subtract(start).dot(along) / along.dot(along)));

  return position.distance(start.add(along.scale(at)));
};

const inside = ([x, y], triangle) => triangle.every(([fromX, fromY], i) => {
  const [toX, toY] = triangle[(i + 1) % triangle.length];

  return (toX - fromX) * (y - fromY) - (toY - fromY) * (x - fromX) >= 0;
});
const apart = ([x, y], [toX, toY]) => (x - toX) ** 2 + (y - toY) ** 2;

export class Asteroid extends Sprite.class {
  constructor(props) {
    super(props);
    this.x = props.x;
    this.y = props.y;

    this.bounciness = rockBounciness;
    this.stroke = colors.white[2];
    // Drifts like everything else does, just with next to no drag of its own
    this.drag = rockDrag;
    this.maxSpeed = rockMaxSpeed;

    // A rock never changes shape, so its outline is only worked out the once.
    // Anything else drifting about out there is the same but cut differently
    this.outline = props.outline || createPolygon({
      points: this.points || pointsFor(this.radius),
      radius: this.radius,
      radiusEven: this.radiusEven,
      variance: this.variance ?? rockVariance,
    });
    // Points that wandered outwards reach further than the radius they were
    // cut from, and a collision check has to know about all of them
    this.triangles = props.triangles || this.outline.map((point, i) => [
      [0, 0],
      point,
      this.outline[(i + 1) % this.outline.length],
    ]);
    this.radius = Math.max(...this.outline.map(([x, y]) => Math.hypot(x, y)));
    // Heft grows with size, so a big rock shrugs off what shoves a pebble and
    // holds its drift far longer
    this.mass = this.radius ** 2;
    this.health = this.radius * 2;
    this.path = shapePath(this.outline);
  }

  crack(x, y) {
    const sides = this.outline.length;

    if (sides < 4 || sides === 6 || this.pieces) return;

    if (sides < 6) {
      const lengths = this.outline.map((point, i) =>
        apart(point, this.outline[(i + 2) % sides]) +
        (sides - 4 && apart(point, this.outline[(i + 3) % sides])));
      const corner = lengths.indexOf(Math.min(...lengths));

      const point = this.outline[corner];

      this.pieces = Array.from({ length: sides - 2 }, (_, i) => [[
        point,
        this.outline[(corner + i + 1) % sides],
        this.outline[(corner + i + 2) % sides],
      ]]);
      this.cracks = Array.from({ length: sides - 3 }, (_, i) => [
        point,
        this.outline[(corner + i + 2) % sides],
      ]);
    } else {
      const point = rotatePoint({ x: x - this.x, y: y - this.y }, -this.rotation);
      let start = 0;
      let nearest = Infinity;

      this.triangles.forEach((triangle, i) => {
        const distance = Math.hypot(point.x - triangle[1][0], point.y - triangle[1][1]);

        if (distance < nearest) [nearest, start] = [distance, i];
      });

      // Start at the mined corner, give each piece two triangles, then randomly
      // place any remainder
      const triangles = [...this.triangles.slice(start), ...this.triangles.slice(0, start)];
      const count = Math.floor(triangles.length / 2);
      const sizes = Array(count).fill(2);

      for (let i = count * 2; i < triangles.length; i++) {
        sizes[Math.floor(Math.random() * count)]++;
      }

      let at = 0;

      this.pieces = sizes.map((size) => triangles.slice(at, at += size));
      this.cracks = this.pieces.map((piece) => [piece[0][0], piece[0][1]]);
    }
    this.crackPath = linesPath(this.cracks);
  }

  split() {
    if (!this.pieces) return [[], this.contents || []];

    const children = this.pieces.map((triangles) => {
      const outline = [triangles[0][0], triangles[0][1], ...triangles.map((part) => part[2])];
      const [centerX, centerY] = measure(outline);
      const offset = rotatePoint({ x: centerX, y: centerY }, this.rotation);
      const radius = Math.max(...outline.map(([x, y]) => Math.hypot(x - centerX, y - centerY)));
      const scale = 1 - lineWidth / radius;
      const local = ([x, y]) => [(x - centerX) * scale, (y - centerY) * scale];
      // Rebase around the child's own centroid without moving any world point
      const child = new Asteroid({
        // The centroid carries the tangential speed it had while the parent
        // rotated, so neither position nor motion jumps at the split
        dx: this.dx - offset.y * this.spin,
        dy: this.dy + offset.x * this.spin,
        outline: outline.map(local),
        rotation: this.rotation,
        spin: this.spin,
        triangles: triangles.map((triangle) => triangle.map(local)),
        x: this.x + offset.x,
        y: this.y + offset.y,
      });

      child.fromParent = [centerX, centerY];
      return child;
    });
    const loose = [];

    this.contents?.forEach((item) => {
      const point = rotatePoint({ x: item.x - this.x, y: item.y - this.y }, -this.rotation);
      const cracked = this.cracks.some((line) => distanceTo(point, line) < item.radius * 2);
      const child = !cracked && children.find((part) => {
        const local = [point.x - part.fromParent[0], point.y - part.fromParent[1]];

        return part.triangles.some((triangle) => inside(local, triangle));
      });

      if (!child) loose.push(item);
      else {
        const x = point.x - child.fromParent[0];
        const y = point.y - child.fromParent[1];

        (child.contents ||= []).push(item);
        item.buried = { rotation: item.rotation - child.rotation, x, y };
      }
    });

    return [children, loose];
  }

  /**
   * Tuck an item away in the heart of the rock. Everything buried starts at the
   * very middle and is settled against the rock's other finds. A buried item
   * rides along with the rock until a horn grinds it open.
   *
  * @param {Item} item
  */
  bury(item) {
    item.x = item.y = undefined;
    this.contents = distribute([...(this.contents || []), item], {
      density: 2,
      width: this.radius,
    });
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
    ctx.fill(this.path);
    ctx.stroke(this.path);

    if (this.crackPath) {
      ctx.stroke(this.crackPath);
    }

    ctx.restore();
  }
}
