import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins';

const root = process.cwd();
const scenario = `
import assert from 'node:assert/strict';
import { Targeting, targetBounds } from '${root}/src/client/ui/targeting.ts';
import { camera } from '${root}/src/client/camera.ts';
const object = (id, x, y, extra = {}) => ({ id, position: {x, y}, rotation: 0, radius: 10, kind: 'asteroid', name: 'Asteroid', ...extra });
const ship = object(1, 0, 0);
const near = object(2, 20, 0, {kind: 'ship', name: 'aé🦄', playerId: 8});
const far = object(3, 80, 0, {kind: 'station', name: 'Corral-6'});
const hidden = object(4, 5, 0, {buried: true});
const dead = object(5, 10, 0, {dead: true});
const outside = object(6, 1000, 0);
const edge = object(7, 205, 0, {kind: 'item', name: 'Diamond'});
const projectile = object(10, 2, 0, {kind: 'projectile', playerId: 8});
const looseModule = object(11, 3, 0, {kind: 'object', name: 'Horn drill'});
const unknown = object(12, 4, 0, {kind: undefined});
const objects = [outside, far, dead, near, hidden, ship, edge, projectile, looseModule, unknown];
const game = {width: 200, height: 200, uiWidth: 400, uiHeight: 400, scale: 2, uiScale: 1};
camera.x = camera.y = -100;
const poses = new Map([[edge.id, {position: {x: 105, y: 0}, rotation: 0}]]);
const targeting = new Targeting();
const update = () => targeting.update({ game, objects, poses, ship });
update();
for (const excluded of [projectile, looseModule, unknown]) {
  targeting.hover(excluded.position);
  assert.equal(targeting.hoveredObject, undefined, 'projectiles, loose modules and generic objects cannot be hovered');
  targeting.targetHovered();
  assert.equal(targeting.target, undefined, 'excluded objects cannot be targeted by clicking');
}
for (const expected of [near, far, edge, near]) {
  targeting.cycleTarget();
  assert.equal(targeting.target, expected, 'target cycling visits visible objects in distance order');
}
targeting.cycleTarget(true);
assert.equal(targeting.target, edge, 'reverse target cycling wraps');
targeting.hover({x: 20, y: 0}); update();
assert.equal(targeting.hoveredObject, near, 'hover previews the pointed object');
assert.equal(targeting.target, edge, 'hover preserves the keyboard target');
targeting.targetHovered();
assert.equal(targeting.target, near, 'click targets the hovered object');
targeting.hover({x: 60, y: 30}); update();
assert.equal(targeting.hoveredObject, undefined, 'leaving an object clears hover');
assert.equal(targeting.target, near, 'leaving an object preserves the clicked target');
targeting.targetHovered();
assert.equal(targeting.target, undefined, 'clicking empty space clears the target');
targeting.cycleTarget();
assert.equal(targeting.target, near, 'cycling starts at the closest object after clearing the target');
targeting.cycleTarget();
assert.equal(targeting.target, far, 'cycling continues from the targeted object');
far.dead = true; update();
assert.equal(targeting.target, undefined, 'removed targets clear the current target');
targeting.cycleTarget();
assert.equal(targeting.target, near, 'cycling restarts from surviving nearest object');
targeting.clear();
assert.equal(targeting.target, undefined, 'clearing removes the target');
const shape = object(8, 0, 0, {shapeOutline: [[-2, -4], [2, -4], [2, 4], [-2, 4]]});
for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
  assert.deepEqual(targetBounds(shape, {position: {x: 20, y: 30}, rotation}),
    {left: 10, right: 30, top: 20, bottom: 40}, 'target bounds follow rendered position without changing with rotation');
}
const craft = object(9, 0, 0, {segments: [{module: {}, health: 5, localPosition: {x: 999, y: 0}, points: () => { throw new Error('animated geometry must not size target bounds'); }, radius: () => { throw new Error('module radius must not size target bounds'); }}]});
assert.deepEqual(targetBounds(craft, craft), {left: -10, right: 10, top: -10, bottom: 10}, 'craft target bounds use the GameObject radius');
near.dead = false;
targeting.hover({x: 20, y: 0}); update();
const commands = [], calls = [], strokes = [], alphas = [];
globalThis.Path2D = class {
  moveTo(...args) { commands.push(['move', ...args]); }
  lineTo(...args) { commands.push(['line', ...args]); }
  addPath() {}
};
game.ctx = {globalAlpha: 1, save() {alphas.push(this.globalAlpha);}, restore() {this.globalAlpha = alphas.pop();}, scale() {}, translate() {}, stroke() {strokes.push(this.globalAlpha);}, strokeText(...args) {calls.push(['stroke', ...args]);}, fillText(...args) {calls.push(['fill', ...args]);}};
targeting.render(game);
assert.equal(commands.filter(([kind]) => kind === 'move').length, 6, 'hover draws six open hexagon corners');
const vertices = commands.filter((_, index) => index % 3 === 1).map(([, x, y]) => [x, y]);
assert.equal(vertices.length, 6);
const edgeLengths = vertices.map(([x, y], index) => Math.hypot(x - vertices[(index + 1) % 6][0], y - vertices[(index + 1) % 6][1]));
assert(edgeLengths.every(length => Math.abs(length - edgeLengths[0]) < 1e-10), 'target corners describe a regular hexagon');
const lineLengths = () => commands.filter((_, index) => index % 3 !== 1).map(([, x, y], index) => {
  const vertex = commands[Math.floor(index / 2) * 3 + 1];
  return Math.hypot(x - vertex[1], y - vertex[2]);
});
const originalRadius = near.radius;
const samples = [];
for (const radius of [0.01, 1, 5, 20, 100, 500]) {
  near.radius = radius;
  update();
  commands.length = 0;
  targeting.render(game);
  const lengths = lineLengths();
  const sideLength = Math.hypot(commands[1][1] - commands[4][1], commands[1][2] - commands[4][2]);
  assert(lengths.every(length => Number.isFinite(length) && length > 0), 'every corner remains visible and finite');
  assert(lengths.every(length => Math.abs(length - lengths[0]) < 1e-10), 'all corner arms have matching lengths');
  assert(lengths.every(length => length * 2 < sideLength), 'adjacent corners leave gaps on tiny and large targets');
  samples.push([radius, lengths[0]]);
}
assert(samples[0][1] > samples[0][0] * game.scale / game.uiScale * 0.3, 'tiny items have longer corners than proportional radius scaling');
for (let index = 1; index < samples.length; index++) {
  const [radius, length] = samples[index];
  const [previousRadius, previousLength] = samples[index - 1];
  assert(length > previousLength, 'larger targets still have longer corner arms');
  assert(length / previousLength < radius / previousRadius, 'corner lengths grow more slowly than object radius');
}
near.radius = 0;
update();
commands.length = 0;
targeting.render(game);
assert(lineLengths().every(length => length === 0), 'corner line lengths have no minimum at zero radius');
near.radius = originalRadius;
update();
commands.length = 0;
strokes.splice(2);


assert.deepEqual(strokes, [0.5, 0.5], 'hover corners and their outline use 50 percent opacity');
assert.equal(calls.length, 0, 'hover hides object names');
assert.equal(game.ctx.globalAlpha, 1, 'hover restores drawing opacity');
targeting.targetHovered();
strokes.length = commands.length = 0;
targeting.render(game);
assert.equal(commands.filter(([kind]) => kind === 'move').length, 6, 'targeted hover draws one set of hexagon corners');
assert.deepEqual(strokes, [0.9, 0.9], 'targeted corners and their outline use targeted opacity');
const originalCorners = commands.map(command => [...command]);
near.rotation = Math.PI / 4;
update();
commands.length = 0;
targeting.render(game);
assert.deepEqual(commands, originalCorners, 'rotating a targeted object leaves its corner positions unchanged');
calls.splice(0, 2);

assert.deepEqual(calls.map(call => call.slice(0, 2)), [['stroke', 'a□□'], ['fill', 'a□□']], 'targeting labels use native text outline and unsupported glyph boxes');
far.dead = false;
targeting.hover({x: 80, y: 0}); update();
calls.length = strokes.length = 0;
targeting.render(game);
assert.deepEqual(strokes, [0.5, 0.5, 0.9, 0.9], 'a different hover preview coexists with targeted corners');
assert.deepEqual(calls.map(call => call.slice(0, 2)), [['stroke', 'a□□'], ['fill', 'a□□']], 'only the targeted object has a name');
targeting.targetHovered();
assert.equal(targeting.target, far, 'targeting another object replaces the previous target');
calls.length = strokes.length = commands.length = 0;
targeting.render(game);
assert.deepEqual(strokes, [0.9, 0.9], 'changing target draws only one fully targeted indicator');
assert.equal(calls.filter(([kind]) => kind === 'fill').length, 1, 'changing target draws only one target name');
const otherController = new Targeting();
otherController.update({ game, objects, poses, ship });
otherController.cycleTarget();
assert.equal(otherController.target, near, 'another craft controller has its own target');
assert.equal(targeting.target, far, 'another controller does not change this controller target');
targeting.hover({x: 20, y: 0});
targeting.targetHovered();
targeting.hover(); update();
assert.equal(targeting.target, near, 'leaving the canvas preserves the current target');
assert.equal(targeting.hoveredObject, undefined);
near.playerId = undefined;
near.name = 'Diamond';
targeting.render(game);
assert.equal(calls.at(-1)[1], 'Diamond', 'items display their item name');
near.name = 'Corral-5';
near.kind = 'station';
targeting.render(game);
assert.equal(calls.at(-1)[1], 'Corral-5', 'stations display their name rather than a spec identifier');
targeting.targetHovered();
calls.length = commands.length = 0;
targeting.render(game);
assert.equal(calls.length, 0, 'clicking empty space hides the target name');
assert.equal(commands.length, 0, 'clicking empty space removes targeted corners');
for (const kind of ['ship', 'station', 'craft', 'asteroid', 'item']) {
  const candidate = object(20, 0, 0, {kind, name: 'Named target', definitionId: 'internal-spec-key'});
  const controller = new Targeting();
  controller.update({game, objects: [candidate], poses, ship});
  controller.cycleTarget();
  assert.equal(controller.target, candidate, 'crafts, asteroids and items can be targeted');
  calls.length = 0;
  controller.render(game);
  assert.equal(calls.at(-1)[1], 'Named target', 'target names use one field for every targetable kind');
}
console.log('Target cycling, click targeting, persistent targets, hover opacity, labels and rendered bounds passed');
`;

for (const production of [false, true]) {
  const entry = `${root}/src/__targeting-test.ts`;

  const bundle = await rolldown({
    input: entry,
    external: ['node:assert/strict'],
    plugins: [
      {
        name: 'targeting-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? scenario.replace(
                /assert\.(\w+)/g,
                (_, method) => `Reflect.get(assert, '${method}')`,
              )
            : undefined,
      },
      buildPrePlugin({ DEBUG: !production }),
      ...(production ? [{ ...buildPlugin(), generateBundle: undefined }] : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  assert.equal(output.length, 1);
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(output[0].code).toString('base64')
  );
}
