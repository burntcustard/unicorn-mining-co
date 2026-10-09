import { Buffer } from 'node:buffer';

/**
 * Four Windows Unicode names, sharing one family string and one style string.
 */
function nameTable(family: string) {
  const strings = [family, 'Regular'].map((text) =>
    Buffer.from(text, 'utf16le').swap16(),
  );
  const header = Buffer.alloc(6 + 4 * 12);

  header.writeUInt16BE(4, 2);
  header.writeUInt16BE(header.length, 4);

  [1, 2, 4, 6].forEach((id, index) => {
    const offset = 6 + index * 12;
    const style = id === 2;

    header.writeUInt16BE(3, offset); // Windows
    header.writeUInt16BE(1, offset + 2); // Unicode BMP
    header.writeUInt16BE(0x409, offset + 4); // English
    header.writeUInt16BE(id, offset + 6);
    header.writeUInt16BE(strings[style ? 1 : 0].length, offset + 8);
    header.writeUInt16BE(style ? strings[0].length : 0, offset + 10);
  });

  return Buffer.concat([header, ...strings]);
}

/**
 * Keep the writer's Windows Unicode mappings (BMP and, when present, full
 * Unicode). Its Macintosh map and duplicate platform-0 map are unnecessary.
 */
function characterMap(bytes: Buffer) {
  const records = [];

  for (let i = 0; i < bytes.readUInt16BE(2); i++) {
    const header = bytes.subarray(4 + i * 8, 12 + i * 8);

    if (header.readUInt16BE() !== 3) continue;
    const start = header.readUInt32BE(4);
    const length =
      bytes.readUInt16BE(start) === 12
        ? bytes.readUInt32BE(start + 4)
        : bytes.readUInt16BE(start + 2);

    records.push({ header, table: bytes.subarray(start, start + length) });
  }

  const header = Buffer.alloc(4 + records.length * 8);
  let offset = header.length;

  header.writeUInt16BE(records.length, 2);

  records.forEach((record, i) => {
    record.header.copy(header, 4 + i * 8);
    header.writeUInt32BE(offset, 8 + i * 8);
    offset += record.table.length;
  });

  return Buffer.concat([header, ...records.map(({ table }) => table)]);
}

/**
 * Compact fonteditor-core's output, then rebuild its directory and checksums.
 * This handles our generated, unhinted TrueType fonts, not arbitrary fonts.
 */
export function compactTrueType({
  buffer,
  family,
}: {
  buffer: Buffer;
  family: string;
}) {
  const tables = Array.from({ length: buffer.readUInt16BE(4) }, (_, i) => {
    const record = 12 + i * 16;
    const tag = buffer.toString('ascii', record, record + 4);
    const start = buffer.readUInt32BE(record + 8);
    let bytes = Buffer.from(
      buffer.subarray(start, start + buffer.readUInt32BE(record + 12)),
    );

    if (tag === 'name') bytes = nameTable(family);

    if (tag === 'cmap') bytes = characterMap(bytes);

    if (tag === 'OS/2') {
      bytes = bytes.subarray(0, 78); // Version 0 has all the metrics we use.
      bytes.writeUInt16BE(0);
      bytes.writeUInt32BE(0, 46); // Undo the writer's private-use range flag.
    }

    if (tag === 'head') {
      bytes.fill(0, 8, 12); // Reset checksum before recalculating.
      bytes.fill(0, 20, 36); // Omit timestamps.
    }

    if (tag === 'post') bytes.fill(0, 16); // Unused printer memory estimates.
    return { tag, bytes, paddedLength: (bytes.length + 3) & ~3 };
  });

  let offset = 12 + tables.length * 16;
  const result = Buffer.alloc(
    offset + tables.reduce((sum, table) => sum + table.paddedLength, 0),
  );
  let headOffset = 0;

  const checksum = (bytes: Buffer) => {
    let sum = 0;

    for (let i = 0; i < bytes.length; i += 4) sum += bytes.readUInt32BE(i);
    return sum >>> 0;
  };

  buffer.copy(result, 0, 0, 12);

  tables.forEach(({ tag, bytes, paddedLength }, i) => {
    const record = 12 + i * 16;

    bytes.copy(result, offset);
    result.write(tag, record, 4, 'ascii');
    result.writeUInt32BE(
      checksum(result.subarray(offset, offset + paddedLength)),
      record + 4,
    );
    result.writeUInt32BE(offset, record + 8);
    result.writeUInt32BE(bytes.length, record + 12);

    if (tag === 'head') headOffset = offset;
    offset += paddedLength;
  });

  result.writeUInt32BE((0xb1b0afba - checksum(result)) >>> 0, headOffset + 8);
  return result;
}
