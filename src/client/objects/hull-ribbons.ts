import type { Craft } from './craft';
import type { Segment } from '../types';
import { ribbonSections } from '../utilities/ribbon';
import * as Vec from '../utilities/vector';
import { shapeOf } from '../utilities/geometry';
import { sampleOutline } from '../utilities/curves';

/*
 * Each section retains its own curved surface for detached debris. Intact
 * sections draw one outline around the full ribbon, without crosswise seams.
 */
export const updateHullRibbons = (craft: Craft) => {
  const ribbons = craft.segments.filter(
    (segment) => segment.hull && segment.module.ribbon,
  );
  const children = (segment: Segment) =>
    ribbons.find(
      (other) =>
        craft.hullSegments[other.module.animation.parent] === segment.module,
    );
  const roots = ribbons.filter(
    (segment) =>
      !ribbons.some(
        (other) =>
          other.module === craft.hullSegments[segment.module.animation.parent],
      ),
  );

  for (const root of roots) {
    const chain = [root];
    let child: Segment | undefined;

    while ((child = children(chain.at(-1)!))) chain.push(child);
    const corners = chain.map((segment) => segment.points as number[][]);
    const center = (a: number[], b: number[]) =>
      Vec.create((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const points = [
      center(corners[0][0], corners[0][3]),
      ...corners.map((part) => center(part[1], part[2])),
    ];
    const widths = [
      Math.hypot(
        corners[0][0][0] - corners[0][3][0],
        corners[0][0][1] - corners[0][3][1],
      ) / 2,
      ...corners.map(
        (part) =>
          Math.hypot(part[1][0] - part[2][0], part[1][1] - part[2][1]) / 2,
      ),
    ];
    const sections = ribbonSections(points, widths);
    let connected: typeof sections = [];
    let first: Segment | undefined;

    const finish = () => {
      if (first) {
        first.ribbonPath = [
          connected[0].near,
          ...connected.map((part) => part.forward),
          connected.at(-1)!.far,
          ...connected.toReversed().map((part) => part.backward),
        ];
        first.ribbonFill = shapeOf(sampleOutline(first.ribbonPath));
      }

      connected = [];
      first = undefined;
    };

    chain.forEach((segment, index) => {
      const section = sections[index];

      segment.curvePoints = [
        section.near,
        section.forward,
        section.far,
        section.backward,
      ];
      segment.ribbonPath = undefined;
      segment.ribbonFill = undefined;

      if (segment.health < 1) {
        finish();
      } else {
        first ||= segment;
        connected.push(section);
      }
    });

    finish();
  }
};
