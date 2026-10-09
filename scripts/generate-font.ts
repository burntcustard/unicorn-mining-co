import { Buffer } from 'node:buffer';
import { compactTrueType } from './compact-font.ts';
import { writeFileSync } from 'node:fs';
import ClipperLib from 'clipper-lib';
import { Font, woff2, type TTF } from 'fonteditor-core';
import { glyphPaths } from '../font/glyph-paths.ts';

// Eight font units per path unit: 16px em, 13px advance, 13px baseline.
// A 1/8-unit grid keeps the approved appearance while reducing coordinate bytes.
const precision = 8;

// Object iteration puts digit keys first; retain Unicode order in the font.
const paths = Object.entries(glyphPaths)
  .filter(([, path]) => path)
  .sort(([a], [b]) => a.codePointAt(0)! - b.codePointAt(0)!);

export function glyphContours(path: string): TTF.Contour[] {
  const polygons: ClipperLib.Paths = [];

  const polygon = (points: number[][]) => {
    const contour = points.map(([x, y]) => ({
      X: Math.round(x * precision),
      Y: Math.round((13 - y) * precision),
    }));

    if (!ClipperLib.Clipper.Orientation(contour)) contour.reverse();
    polygons.push(contour);
  };

  // The initial M is implicit; paths only contain coordinates, M and Z.
  // Fail on new commands rather than silently producing the wrong glyph.
  if (!/^[\d .-]+Z?(M[\d .-]+Z?)*$/.test(path)) {
    throw new Error(`Invalid glyph: ${path}`);
  }

  for (const subpath of path.split('M')) {
    const closed = subpath.endsWith('Z');
    const numbers = subpath.replace('Z', '').trim().split(/\s+/).map(Number);

    if (numbers.length % 2) throw new Error(`Unpaired coordinate: ${path}`);

    const points = Array.from({ length: numbers.length / 2 }, (_, i) =>
      numbers.slice(i * 2, i * 2 + 2),
    );
    const count = points.length - (closed ? 0 : 1);

    const normals = Array.from({ length: count }, (_, i) => {
      const [x, y] = points[i];
      const [nextX, nextY] = points[(i + 1) % points.length];
      const length = Math.hypot(nextX - x, nextY - y);

      if (!length) throw new Error(`Zero-length segment: ${path}`);
      return [(y - nextY) / length, (nextX - x) / length];
    });

    normals.forEach(([nx, ny], i) => {
      const [x, y] = points[i];
      const [nextX, nextY] = points[(i + 1) % points.length];

      polygon([
        [x + nx, y + ny],
        [nextX + nx, nextY + ny],
        [nextX - nx, nextY - ny],
        [x - nx, y - ny],
      ]);

      if (i || closed) {
        const [px, py] = normals[(i + normals.length - 1) % normals.length];

        // Triangles bridge the outside of each join, exactly as a bevel does.
        for (const side of [-1, 1]) {
          polygon([
            [x, y],
            [x + px * side, y + py * side],
            [x + nx * side, y + ny * side],
          ]);
        }
      }
    });
  }

  // Keep touching contours intact; SimplifyPolygons splits them apart.
  const clipper = new ClipperLib.Clipper();
  const contours: ClipperLib.Paths = [];

  clipper.AddPaths(polygons, ClipperLib.PolyType.ptSubject, true);
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    contours,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  // TrueType uses clockwise outer contours and counterclockwise holes.
  return ClipperLib.Clipper.CleanPolygons(contours, 0).map((contour) => {
    contour.reverse();
    // Start at the leftmost, then lowest point. Consistent contour starts
    // compress better in WOFF2's coordinate streams without changing geometry.
    const start = contour.reduce(
      (best, point, i) =>
        point.X < contour[best].X ||
        (point.X === contour[best].X && point.Y < contour[best].Y)
          ? i
          : best,
      0,
    );

    return [...contour.slice(start), ...contour.slice(0, start)].map(
      ({ X, Y }) => ({ x: X, y: Y, onCurve: true }),
    );
  });
}

export async function generateFont() {
  const font = Font.create();
  const data = font.get();

  data.glyf = [['', ''], [' ', ''], ...paths].map(([character, path]) => {
    const contours = path ? glyphContours(path) : [];
    const points = contours.flat();
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    const xMin = points.length ? Math.min(...xs) : 0;

    return {
      name: character || '.notdef',
      unicode: character ? [character.codePointAt(0)!] : [],
      // Moving stored coordinates to x=0 makes their deltas smaller. The
      // original left bearing restores the exact placement during rendering.
      contours: contours.map((contour) =>
        contour.map((point) => ({ ...point, x: point.x - xMin })),
      ),
      xMin: 0,
      yMin: points.length ? Math.min(...ys) : 0,
      xMax: points.length ? Math.max(...xs) - xMin : 0,
      yMax: points.length ? Math.max(...ys) : 0,
      advanceWidth: 13 * precision,
      leftSideBearing: xMin,
    };
  });

  Object.assign(data.head, {
    unitsPerEm: 16 * precision,
    flags: 1, // The left bearing is no longer equal to the stored xMin.
  });

  Object.assign(data.hhea, {
    ascent: 14 * precision,
    descent: -2 * precision,
    lineGap: 0,
  });

  // The writer encodes omitted numeric fields as zero. Avoid its sample-font
  // defaults for subscripts, superscripts, vendor names and optional metadata.
  Object.assign(data, {
    'OS/2': {
      usWeightClass: 400,
      usWidthClass: 5,
      fsSelection: 64,
      bFamilyType: 2,
      bWeight: 5,
      bProportion: 9,
      ulUnicodeRange1: 1,
      achVendID: '    ',
      sTypoAscender: data.hhea.ascent,
      sTypoDescender: data.hhea.descent,
      usWinAscent: 14 * precision,
      usWinDescent: 3 * precision,
    },
    post: { format: 3, isFixedPitch: 1 },
  });

  await woff2.init();

  return Buffer.from(
    woff2.encode(
      compactTrueType({
        buffer: font.write({ type: 'ttf', toBuffer: true }),
        family: 'Gemetric',
      }),
    ),
  );
}

if (import.meta.main) {
  const buffer = await generateFont();

  writeFileSync(new URL('../font/gemetric.woff2', import.meta.url), buffer);

  console.log(
    process.argv.includes('--json')
      ? JSON.stringify({
          characters: paths.map(([character]) => character),
          bytes: buffer.length,
        })
      : `Gemetric WOFF2: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KiB)`,
  );
}
