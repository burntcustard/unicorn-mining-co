import { diamond, gold } from './items';
import { Asteroid } from './asteroid';
import { Craft } from './craft';
import { Item } from './item';
import { colors } from './colors';
import { game } from './game';
import { shipTypes } from './ships';
import { traceBeam } from './prism';

export const testSections = (scenery, playerShip, lamp) => {
  const five = scenery.find((asteroid) =>
    asteroid.outline.length === 5 && asteroid.health < 240);
  const triangle = new Asteroid({ points: 3, radius: 90 });

  if (triangle.sections.length !== 4 ||
    five.sections.length !== five.outline.length * 4 ||
    five.hitboxes().length !== 1 ||
    five.sections.some((section) => section.asteroid !== five)) {
    throw Error('five');
  }

  const asteroid = scenery.find((object) => object.outline.length === 7);
  const leaf = asteroid.sections[0];
  const count = asteroid.sections.length;
  const velocity = asteroid.velocity;

  asteroid.spin = 0;
  leaf.health /= 2;
  const [children] = asteroid.detach(leaf);
  const [piece, remainder] = children;

  scenery.splice(scenery.indexOf(asteroid), 1, ...children);

  if (children.length !== 2 || asteroid.sections.length || remainder.sections.includes(leaf)) {
    throw Error('detach');
  }

  if (remainder.sections.length !== count - 1 || !piece.lifetime) {
    throw Error('leaf');
  }

  const pieceSpeed = piece.velocity.subtract(velocity).length();
  const remainderSpeed = remainder.velocity.subtract(velocity).length();

  if (pieceSpeed <= remainderSpeed ||
    Math.abs(pieceSpeed * piece.mass - remainderSpeed * remainder.mass) > 1e-9) {
    throw Error('leaf force');
  }

  Object.assign(remainder, { x: playerShip.x, y: playerShip.y });
  const beam = traceBeam(playerShip, lamp, [remainder]);

  if (beam.outlines[0].length !== remainder.outline.length) throw Error('light');
  const cargoRock = new Asteroid({ points: 5, radius: 90 });
  const cargoItem = new Item({ itemData: diamond });
  const otherCargo = new Item({ itemData: gold });

  cargoRock.bury(cargoItem);
  cargoRock.bury(otherCargo);

  if (cargoRock.contents.length !== 2 ||
    cargoRock.sections.filter(({ contents }) => contents.length).length !== 2 ||
    cargoItem.buried.x === otherCargo.buried.x) {
    throw Error('cargo placement');
  }

  const oversized = new Item({ itemData: gold });

  oversized.radius = cargoRock.radius;
  cargoRock.bury(oversized);

  if (!cargoRock.contents.includes(oversized) ||
    !cargoRock.sections.some((section) => section.contents.includes(oversized))) {
    throw Error('cargo snap');
  }

  const [cargoParts, early] = cargoRock.detach(
    cargoRock.sections.find((section) => !section.contents.length),
  );
  const cargoPart = cargoParts.find((part) =>
    part.sections?.some((section) => section.contents.includes(cargoItem)));

  if (early.length || !cargoPart) throw Error('cargo early');
  const [cargoDebris, released] = cargoPart.detach(
    cargoPart.sections.find((section) => section.contents.includes(cargoItem)),
  );

  const debris = cargoDebris.find((part) => part.contents.includes(cargoItem));
  const expired = [];

  debris.update(11, expired);

  if (released.length || debris.dead || expired.length) throw Error('cargo expiry');

  const [spent, mined] = debris.split();

  if (spent.length || mined[0] !== cargoItem) throw Error('cargo mining');

  const splitShip = new Craft({ craftData: shipTypes.mustang, shades: colors.white });

  splitShip.segments[1].health = 0;
  const fragments = splitShip.update(0);

  if (fragments.length !== 1 || fragments[0].segments.length !== 1 ||
    !splitShip.cockpit.hull.health || !splitShip.velocity.length() ||
    !fragments[0].velocity.length() || fragments[0].position.distanceTo(splitShip.position) < 1 ||
    Object.getPrototypeOf(fragments[0]) === splitShip) throw Error('ship edge');
  const fragmentSpin = fragments[0].spin;

  fragments[0].update(0.1);
  if (fragments[0].spin !== fragmentSpin) throw Error('fragment spin');
  splitShip.spin = 1;
  splitShip.update(0.1);
  if (splitShip.spin !== 1) throw Error('ship spin');
  fragments[0].update(11);
  if (!fragments[0].dead) throw Error('fragment lifetime');
  const wreck = new Craft({ craftData: shipTypes.mustang, shades: colors.white });
  const cargo = new Item({ itemData: diamond });

  cargo.remove();
  wreck.cargo.push(cargo);
  wreck.cockpit.hull.health = 0;
  const wreckage = wreck.update(0);

  if (!wreck.dead || !game.items.includes(cargo) || cargo.velocity.x !== wreck.velocity.x) {
    throw Error('wreck');
  }

  if (wreckage.length !== 7 || wreckage.some((part) => part.dead || part.velocity.length() < 29)) {
    throw Error('wreck drift');
  }

  return {
    children: children.length,
    leafHealth: leaf.maxHealth,
    fragments: fragments.length,
    sections: asteroid.sections.length,
  };
};
