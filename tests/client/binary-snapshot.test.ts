import assert from 'node:assert/strict';
import {
  decodeBinarySnapshot,
  mergeModuleStates,
  BinaryField,
} from '../../src/client/protocol/binary-snapshot';
import { colors } from '../../src/specs/colors';
import { moduleIds } from '../../src/specs/modules';

class Writer {
  bytes: number[] = [];

  byte(value: number) {
    this.bytes.push(value);
  }

  number(value: number) {
    const bytes = new Uint8Array(8);

    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.bytes.push(...bytes);
  }

  numbers(values: number[]) {
    this.unsigned(values.length);
    values.forEach((value) => this.number(value));
  }

  outline(shapes: number[][]) {
    this.unsigned(shapes.length);
    shapes.forEach((shape) => this.numbers(shape));
  }

  packet() {
    return Uint8Array.from(this.bytes);
  }

  record(id: number, fields: [number, (() => void) | null][]) {
    this.unsigned(id);
    this.unsigned(fields.length);

    fields.forEach(([field, write]) => {
      this.unsigned(field * 2 + (write ? 0 : 1));
      write?.();
    });
  }

  string(value: string) {
    this.unsigned(value.length);

    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);

      this.byte(code & 255);
      this.byte(code >> 8);
    }
  }

  unsigned(value: number) {
    do {
      const digit = value % 128;

      value = Math.floor(value / 128);
      this.byte(digit | (value ? 128 : 0));
    } while (value);
  }
}

const start = (writer: Writer, flags: number, tick: number, nextId: number) => {
  writer.byte(0x55);
  writer.byte(0x4d);
  writer.byte(1);
  writer.byte(flags);
  writer.unsigned(tick);
  writer.unsigned(nextId);
};

// Construct packed motion independently, including alternating widths that
// reuse the decoder's scratch buffer.
{
  const writer = new Writer();

  const packed = (value: number, omitted: number) => {
    const number = new Writer();

    number.number(value);
    number.bytes.slice(omitted).forEach((byte) => writer.byte(byte));
  };

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      BinaryField.packedPosition,
      () => {
        packed(-3000.25, 2);
        packed(6300.75, 2);
      },
    ],
    [BinaryField.packedRotation, () => packed(0.75, 3)],
    [
      BinaryField.packedVelocity,
      () => {
        packed(2 ** -24, 2);
        packed(-1, 2);
      },
    ],
    [BinaryField.packedSpin, () => packed(-(2 ** -24), 3)],
  ]);

  const entity = decodeBinarySnapshot(writer.packet()).fullEntities[0];

  assert.deepEqual(entity.position, { x: -3000.25, y: 6300.75 });
  assert.deepEqual(entity.velocity, { x: 2 ** -24, y: -1 });
  assert.equal(entity.rotation, 0.75);
  assert.equal(entity.spin, -(2 ** -24));
}

for (const [field, bytes] of [
  [BinaryField.packedPosition, 11],
  [BinaryField.packedRotation, 4],
] as const) {
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      field,
      () => {
        for (let i = 0; i < bytes; i++) writer.byte(0);
      },
    ],
  ]);

  assert.throws(
    () => decodeBinarySnapshot(writer.packet()),
    /Invalid binary snapshot/,
  );
}

{
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      BinaryField.packedRotation,
      () => {
        for (let i = 0; i < 5; i++) writer.byte(0);
      },
    ],
    [BinaryField.rotation, () => writer.number(0)],
  ]);

  assert.throws(
    () => decodeBinarySnapshot(writer.packet()),
    /Invalid binary snapshot/,
  );
}

// Exercise the nested schema, optional headers, clear tags, and JSON's number
// normalization against bytes assembled independently of the server writer.
{
  const writer = new Writer();

  start(writer, 63, 3, 10);
  writer.unsigned(11); // acknowledgedSequence
  writer.unsigned(5); // inputLead = -3 after zigzag decoding
  writer.unsigned(12); // snapshotSequence
  writer.unsigned(7); // acknowledgedDockSequence
  writer.number(1234); // credits
  writer.unsigned(1); // dock ID mappings
  writer.unsigned(1); // signed -1
  writer.unsigned(84); // signed 42
  writer.unsigned(1);
  writer.unsigned(7); // entityIds
  writer.unsigned(1); // record count

  writer.record(7, [
    [
      1,
      () => {
        writer.unsigned(2);
        writer.byte(0);
        writer.number(4);
        writer.byte(1);

        writer.record(8, [
          [9, () => writer.byte(1)],
          [
            24,
            () => {
              writer.number(1);
              writer.number(2);
            },
          ],
        ]);
      },
    ],
    [5, null],
    [7, () => writer.number(Infinity)],
    [8, () => writer.numbers([-0, NaN, 2])],
    [9, () => writer.byte(2)],
    [10, () => writer.string('a\ud800b')],
    [45, () => writer.number(5)],
    [
      17,
      () => {
        writer.unsigned(2);
        writer.byte(55); // id, health, shades, startup charge
        writer.unsigned(6);
        writer.unsigned(8);
        writer.unsigned(10);
        writer.number(6);
        writer.byte(0); // red palette
        writer.number(0.7);
        writer.number(42);
        writer.unsigned(1);
        writer.byte(9);
        writer.number(0.5);
      },
    ],
    [
      18,
      () => {
        writer.unsigned(1);
        writer.byte(15); // outline, fillShade, stroke, color
        writer.number(9);
        writer.number(2);
        writer.number(3);
        writer.number(8);
        writer.outline([[0, 1]]);
        writer.number(6);
        writer.string('#fa3');
        writer.unsigned(1);
        writer.outline([[2, 3]]);
      },
    ],
    [
      24,
      () => {
        writer.number(-0);
        writer.number(Infinity);
      },
    ],
    [
      30,
      () => {
        writer.unsigned(1);
        writer.numbers([4]);
        writer.number(5);
        writer.number(6);
        writer.number(7);
        writer.outline([[1, 2]]);
      },
    ],
  ]);

  const decoded = decodeBinarySnapshot(writer.packet());

  assert.deepEqual(decoded, {
    type: 'load',
    serverTick: 3,
    nextEntityId: 10,
    acknowledgedSequence: 11,
    inputLead: -3,
    snapshotSequence: 12,
    acknowledgedDockSequence: 7,
    credits: 1234,
    dockIds: [[-1, 42]],
    entityIds: [7],
    fullEntities: [
      {
        id: 7,
        cargoContents: [
          { moduleIndex: 4 },
          { id: 8, kind: 'item', position: { x: 1, y: 2 } },
        ],
        friction: null,
        health: null,
        hullHealth: [0, null, 2],
        kind: 'ship',
        name: 'a\ud800b',
        blockedBeams: 5,
        modules: [
          {
            type: 3,
            mount: 4,
            id: 5,
            health: 6,
            shades: colors.red,
            chargeCooldown: 0.7,
            healthActivated: 42,
            segments: [{ active: 1, activationProgress: 0.5 }],
          },
        ],
        wreckage: [
          {
            radius: 9,
            offset: { x: 2, y: 3 },
            health: 8,
            shapeOutline: [[0, 1]],
            fillShade: 6,
            color: '#fa3',
            stroke: [[[2, 3]]],
          },
        ],
        position: { x: 0, y: null },
        segments: [
          {
            contents: [4],
            health: 5,
            mass: 6,
            maxHealth: 7,
            shapeOutline: [[1, 2]],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    decodeBinarySnapshot(writer.packet().buffer),
    decoded,
    'ArrayBuffer input has the same decoding result',
  );
  const padded = Uint8Array.from([0, ...writer.packet(), 0]);

  assert.deepEqual(decodeBinarySnapshot(padded.subarray(1, -1)), decoded);
  const unknownField = new Writer();

  start(unknownField, 0, 0, 1);
  unknownField.unsigned(1);
  unknownField.record(1, [[BinaryField.stationMarker + 1, null]]);
  const duplicateField = new Writer();

  start(duplicateField, 0, 0, 1);
  duplicateField.unsigned(1);
  duplicateField.record(1, [
    [10, null],
    [10, null],
  ]);

  for (const invalid of [
    unknownField.packet(),
    duplicateField.packet(),
    Uint8Array.from([0]),
    Uint8Array.from([0x55, 0x4d, 2, 0, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 32, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 64, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 128, 0, 1, 0]),
    Uint8Array.from([0x55, 0x4d, 1, 0, 0x80, 0, 1, 0]),
    writer.packet().subarray(0, writer.bytes.length - 1),
    Uint8Array.from([...writer.packet(), 0]),
  ]) {
    assert.throws(
      () => decodeBinarySnapshot(invalid),
      /Invalid binary snapshot/,
    );
  }
}

for (const positions of [[], [{ x: -2999, y: 3.5 }]]) {
  const radar = new Writer();

  start(radar, 64, 0, 1);
  radar.unsigned(positions.length);

  positions.forEach(({ x, y }) => {
    radar.number(x);
    radar.number(y);
  });

  radar.unsigned(0);
  const decoded = decodeBinarySnapshot(radar.packet());

  assert.deepEqual(decoded.asteroidPositions, positions);
  assert.deepEqual(
    decoded.fullEntities,
    [],
    'radar coordinates contain no entity model',
  );
  assert.throws(() => decodeBinarySnapshot(radar.packet().subarray(0, -1)));
}

const invalidRadar = new Writer();

start(invalidRadar, 64, 0, 1);
invalidRadar.unsigned(1);
invalidRadar.number(Infinity);
invalidRadar.number(0);
invalidRadar.unsigned(0);
assert.throws(
  () => decodeBinarySnapshot(invalidRadar.packet()),
  /Invalid binary snapshot/,
);

for (const type of [moduleIds.length - 1, -1, moduleIds.length]) {
  const writer = new Writer();

  writer.bytes.push(0x55, 0x4d, 1, 128 | 16, 4, 1, 3, 1); // stock extension and snapshot sequence
  writer.bytes.push(1, 1, 0, 1); // station 1 replaces its stock with one entry
  writer.bytes.push(1, 2, 1); // module entry, one full module with an ID
  writer.unsigned(type < 0 ? -2 * type - 1 : 2 * type);
  writer.bytes.push(1, 4, 0, 0); // mount -1, ID 2, no segments or entity records

  const packet = writer.packet();

  if (type === moduleIds.length - 1) {
    const entry = decodeBinarySnapshot(packet).stationStock?.entries[0];

    assert(entry && 'module' in entry);
    assert.equal(entry.module.type, type);
    continue;
  }

  assert.throws(() => decodeBinarySnapshot(packet), /Invalid binary snapshot/);
}

// Build module packets independently of the server encoder.
const modulePacket = (write: (writer: Writer) => void, load = false) => {
  const writer = new Writer();

  start(writer, load ? 1 : 0, 0, 2);
  writer.unsigned(1);
  writer.record(1, [[17, () => write(writer)]]);
  return writer.packet();
};

const signedModuleInteger = (writer: Writer, value: number) => {
  writer.unsigned(value < 0 ? -value * 2 - 1 : value * 2);
};

const moduleEntry = (
  writer: Writer,
  id: number,
  palette?: number,
  progress = 0.5,
) => {
  writer.byte(1 | (palette === undefined ? 128 : 4));
  writer.unsigned(8);
  writer.unsigned(0);
  signedModuleInteger(writer, id);

  if (palette !== undefined) writer.byte(palette);
  writer.unsigned(1);
  writer.byte(9);
  writer.number(progress);
};

const full = modulePacket((writer) => {
  writer.unsigned(6); // Three full modules.
  moduleEntry(writer, -1, 0);
  moduleEntry(writer, -2, 1);
  moduleEntry(writer, -3, 2);
}, true);

const previous = decodeBinarySnapshot(full).fullEntities[0];

assert.deepEqual(
  previous.modules?.map((m) => m.shades),
  [colors.red, colors.orange, colors.yellow],
);

const moduleDelta = modulePacket((writer) => {
  writer.unsigned(7); // Three modules with sparse changes.
  writer.byte(2); // Only the second module changed.
  moduleEntry(writer, -2);
});

const changed = decodeBinarySnapshot(moduleDelta).fullEntities[0];

assert.throws(() => mergeModuleStates(changed), /Missing module baseline/);
mergeModuleStates(changed, previous);
assert.deepEqual(changed.modules, previous.modules);

const wrong = decodeBinarySnapshot(moduleDelta).fullEntities[0];

assert.throws(
  () => mergeModuleStates(wrong, { modules: [previous.modules![0]] }),
  /Missing module baseline/,
);

const reordered = {
  modules: [previous.modules![0], previous.modules![2], previous.modules![1]],
};

assert.throws(
  () =>
    mergeModuleStates(
      decodeBinarySnapshot(moduleDelta).fullEntities[0],
      reordered,
    ),
  /Missing module shade baseline/,
);

// The paint update can be followed by sparse animation updates before a render.
const repaintPacket = modulePacket((writer) => {
  writer.unsigned(6);
  moduleEntry(writer, -1, 3);
  moduleEntry(writer, -2, 4);
  moduleEntry(writer, -3, 5);
});

const repainted = decodeBinarySnapshot(repaintPacket).fullEntities[0];

mergeModuleStates(repainted, previous);

const animatedPacket = modulePacket((writer) => {
  writer.unsigned(7);
  writer.byte(2);
  moduleEntry(writer, -2, undefined, 0.75);
});

const animated = decodeBinarySnapshot(animatedPacket).fullEntities[0];

mergeModuleStates(animated, repainted);
const animatedAgain = decodeBinarySnapshot(moduleDelta).fullEntities[0];

mergeModuleStates(animatedAgain, animated);
assert.deepEqual(
  animatedAgain.modules?.map((module) => module.shades),
  [colors.green, colors.cyan, colors.indigo],
);
assert.equal(animated.modules?.[1].segments[0].activationProgress, 0.75);

// A full reordered layout is independent of the prior array.
const layout = modulePacket((writer) => {
  writer.unsigned(4);
  moduleEntry(writer, -3, 5);
  moduleEntry(writer, -1, 3);
});

const refitted = decodeBinarySnapshot(layout).fullEntities[0];

mergeModuleStates(refitted, animatedAgain);
assert.deepEqual(
  refitted.modules?.map((module) => module.id),
  [-3, -1],
);

for (const value of [0, -1, 63, -64, 64, -65, 2 ** 52 - 1, -(2 ** 52 - 1)]) {
  const packet = modulePacket((writer) => {
    writer.unsigned(2);
    writer.byte(1);
    [value, -value, value].forEach((number) =>
      signedModuleInteger(writer, number),
    );
    writer.unsigned(0);
  });

  const module = decodeBinarySnapshot(packet).fullEntities[0].modules![0];

  assert.equal(module.type, value || 0);
  assert.equal(module.mount, -value || 0);
  assert.equal(module.id, value || 0);
}

for (const [index, palette] of Object.values(colors).entries()) {
  const packet = modulePacket((writer) => {
    writer.unsigned(2);
    moduleEntry(writer, -1, index);
  });

  assert.deepEqual(
    decodeBinarySnapshot(packet).fullEntities[0].modules![0].shades,
    palette,
  );
}

for (const bytes of [
  [2, 4, 0, 0, 255, 0], // Unknown palette.
  [2, 128, 0, 0, 0], // Inheritance without an ID or partial array.
  [3, 2], // Bits beyond the array size.
  [2, 1, 128, 0, 0, 0], // Overlong integer.
  [2, 1, 0, 0, 0, 1, 3], // Invalid segment flags.
]) {
  assert.throws(() =>
    decodeBinarySnapshot(
      modulePacket((writer) => bytes.forEach((value) => writer.byte(value))),
    ),
  );
}

assert.throws(() =>
  decodeBinarySnapshot(
    modulePacket((writer) => {
      writer.unsigned(3);
      writer.byte(0);
    }, true),
  ),
);

for (let length = 0; length < full.length; length++) {
  assert.throws(() => decodeBinarySnapshot(full.subarray(0, length)));
}

for (const [code, value] of [
  [0, 0],
  [1, 1],
  [2, -1],
  [3, 0.375],
] as const) {
  const writer = new Writer();

  start(writer, 0, 0, 2);
  writer.unsigned(1);

  writer.record(1, [
    [
      31,
      () => {
        writer.byte(code);

        if (code === 3) writer.number(value);
      },
    ],
    [
      32,
      () => {
        writer.byte(code);

        if (code === 3) writer.number(value);
      },
    ],
  ]);

  const entity = decodeBinarySnapshot(writer.packet()).fullEntities[0];

  assert.equal(entity.thrust, value);
  assert.equal(entity.turn, value);
}
