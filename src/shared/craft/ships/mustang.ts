import { Ship } from '../ship';
import * as Vec from '../../vector';
import {
  CargoHatch,
  SearchLight,
  HornDrill,
  ShieldGenerator,
  ThrusterDualMd,
  ThrusterDualXl,
  ThrusterSingle,
  ThrusterTriple,
} from '../../modules';

export class Mustang extends Ship {
  static cargoSpace = 12;
  static drag = 5 / 9;
  static mass = 9;
  static radius = 40;
  static turnRate = 3;
  static hullSegments = [
    {
      health: 4,
      points: [
        [-16, -36],
        [-4, -36],
        [-16, -20],
      ],
    },
    // The wedges the cargo hatches open onto. They stand aside for cargo while the
    // doors are open, which is what lets an item fall in under the hull and
    // into the throat waiting behind them
    {
      health: 10,
      mounts: [{ fits: [CargoHatch], localPosition: Vec.create(3, -13) }],
      points: [
        [-4, -36],
        [20, -12],
        [-16, -20],
      ],
    },
    {
      health: 10,
      points: [
        [-16, -20],
        [20, -12],
        [8, 0],
      ],
    },
    {
      health: 25,
      // The engine mount: without it there is nothing left to fly
      core: true,
      mounts: [
        {
          fits: [
            ThrusterDualMd,
            ThrusterSingle,
            ThrusterDualXl,
            ThrusterTriple,
          ],
          localPosition: Vec.create(-16, 0),
        },
        { fits: [ShieldGenerator], localPosition: Vec.create() },
      ],
      points: [
        [-16, -20],
        [8, 0],
        [-16, 20],
      ],
    },
    {
      health: 20,
      // Where the pilot sits, so this is the piece the ship is lost without
      core: true,
      mounts: [
        { fits: [HornDrill], localPosition: Vec.create(20, 0) },
        { fits: [SearchLight], localPosition: Vec.create(20, 0) },
      ],
      points: [
        [20, -12],
        [20, 12],
        [8, 0],
      ],
    },
    {
      health: 10,
      points: [
        [8, 0],
        [20, 12],
        [-16, 20],
      ],
    },
    {
      health: 10,
      mounts: [{ fits: [CargoHatch], localPosition: Vec.create(3, 13) }],
      points: [
        [-16, 20],
        [20, 12],
        [-4, 36],
      ],
    },
    {
      health: 4,
      points: [
        [-16, 20],
        [-4, 36],
        [-16, 36],
      ],
    },
  ];
}
