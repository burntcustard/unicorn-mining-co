import { Ship } from '../ship';
import * as Vec from '../../vector';
import { moduleTypesById } from '../../modules';
import { shipSpecifications } from '../../specification/ships';

const specification = shipSpecifications.mustang;

export class Mustang extends Ship {
  static cargoSpace = specification.cargoSpace;
  static drag = specification.drag;
  static mass = specification.mass;
  static radius = specification.radius;
  static turnRate = specification.turnRate;
  static hullSegments = specification.hullSegments.map((segment) => ({
    ...segment,
    ...('mounts' in segment && {
      mounts: segment.mounts.map((mount) => ({
        fits: mount.fits.map((id) => moduleTypesById.get(id)!),
        localPosition: Vec.create(mount.localPosition.x, mount.localPosition.y),
      })),
    }),
  }));
}
