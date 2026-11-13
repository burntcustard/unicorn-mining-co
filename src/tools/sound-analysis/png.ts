import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { silenceDb } from './spectrum.ts';

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
};

/**
 * Stack spectrograms on the same time, frequency, and level scales.
 */
export const writeSpectrogram = (path: string, grids: number[][][]) => {
  const bands = grids[0][0].length;
  const scale = 4;
  const panelHeight = bands * scale + 2;
  const width = Math.max(...grids.map((grid) => grid.length)) * scale;
  const height = panelHeight * grids.length - 2;
  const stride = width + 1;
  const pixels = Buffer.alloc(stride * height);
  let peak = silenceDb;

  for (const grid of grids) {
    for (const column of grid) peak = Math.max(peak, ...column);
  }

  const floor = Math.max(silenceDb, peak - 70);
  const range = Math.max(1, peak - floor);

  grids.forEach((grid, panel) => {
    grid.forEach((column, frame) => {
      column.forEach((value, band) => {
        const intensity = Math.round(
          255 * Math.max(0, Math.min(1, (value - floor) / range)),
        );
        const y = panel * panelHeight + (bands - band - 1) * scale;
        const x = frame * scale + 1;

        for (let row = y; row < y + scale; row++) {
          pixels.fill(intensity, row * stride + x, row * stride + x + scale);
        }
      });
    });
  });

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
    { flag: 'wx' },
  );
};
