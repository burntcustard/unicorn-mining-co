/* global Buffer, process */
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';

Object.assign(globalThis, {
  Path2D: class {
    vertices: number[][] = [];
    addPath(other: { vertices: number[][] }) {
      this.vertices.push(...other.vertices);
    }

    closePath() {}

    lineTo(x: number, y: number) {
      this.vertices.push([x, y]);
    }

    moveTo(x: number, y: number) {
      this.vertices.push([x, y]);
    }
  },
});

const entry = `${process.cwd()}/src/__prism_test.ts`;

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'prism-test-exports',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `import { installExampleModules } from '${process.cwd()}/tests/support/example-modules.ts';
installExampleModules();
export {SearchLight} from './client/objects/modules/index';
export * from './client/utilities/prism';
export * as Vec from './client/utilities/vector';
export {createAsteroid} from './client/objects/asteroid';
export {GameObject} from './client/objects/game-object';
export {Item} from './client/objects/item';
export {diamond, amethyst} from './specs/items';
export {createWorld} from './client/simulation/world';`
          : undefined,
      transform: (code, id) =>
        id.endsWith('/src/client/utilities/prism.ts')
          ? `${code}\nexport { joins, runsOf, spectrumOf, combineSpectra, canCombine };`
          : undefined,
    },
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

const {
  traceBeam,
  filteredPaths,
  drawSpectrum,
  beginSpectra,
  collectSpectrum,
  endSpectra,
  joins: joinFaces,
  runsOf,
  spectrumOf,
  combineSpectra,
  canCombine,
  createAsteroid,
  GameObject,
  Item,
  diamond,
  amethyst,
  createWorld,
  SearchLight,
  Vec,
}: {
  traceBeam: typeof import('../../src/client/utilities/prism').traceBeam;
  filteredPaths: typeof import('../../src/client/utilities/prism').filteredPaths;
  drawSpectrum: typeof import('../../src/client/utilities/prism').drawSpectrum;
  beginSpectra: typeof import('../../src/client/utilities/prism').beginSpectra;
  collectSpectrum: typeof import('../../src/client/utilities/prism').collectSpectrum;
  endSpectra: typeof import('../../src/client/utilities/prism').endSpectra;
  joins: (
    points: import('../../src/client/types').ShapeOutline,
    from: number,
    to: number,
  ) => boolean;
  runsOf: (
    beam: import('../../src/client/utilities/prism').Beam,
  ) => import('../../src/client/utilities/prism').Beam['rays'][];
  spectrumOf: (beam: import('../../src/client/utilities/prism').Beam) => {
    bands: { color: string; path: { vertices: number[][] } }[];
  };
  canCombine: (
    first: import('../../src/client/utilities/prism').Beam['rays'],
    second: import('../../src/client/utilities/prism').Beam['rays'],
  ) => boolean;
  combineSpectra: (
    sources: [
      import('../../src/client/types').Segment,
      import('../../src/client/utilities/prism').Beam,
      import('../../src/client/types').Pose,
    ][],
  ) => [
    import('../../src/client/types').Segment,
    import('../../src/client/utilities/prism').Beam,
    import('../../src/client/types').Pose,
  ][];
  createAsteroid: typeof import('../../src/client/objects/asteroid').createAsteroid;
  GameObject: typeof import('../../src/client/objects/game-object').GameObject;
  Item: typeof import('../../src/client/objects/item').Item;
  diamond: typeof import('../../src/specs/items').diamond;
  amethyst: typeof import('../../src/specs/items').amethyst;
  createWorld: typeof import('../../src/client/simulation/world').createWorld;
  SearchLight: typeof import('../../src/client/objects/modules/search-light').SearchLight;
  Vec: typeof import('../../src/client/utilities/vector');
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

await bundle.close();

// Interior overlap still combines when the exit points have spread apart.
{
  const hit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const ray = (entryY: number, exitY: number) => ({
    at: Vec.create(40, entryY),
    hit,
    out: {
      at: Vec.create(60, exitY),
      away: Vec.create(1, 0),
      normal: Vec.create(-1, 0),
      face: 1,
      distance: 20,
      length: 80,
    },
  });

  assert.ok(canCombine([ray(-7, -12), ray(-2, -7)], [ray(-4, 3), ray(1, 8)]));
}

// Overlapping light through the same rock becomes one spectrum, including
// when the lamps belong to different craft or have different displayed poses.
{
  const world = createWorld();

  const rock = createAsteroid(world, {
    id: 500,
    position: Vec.create(90, 0),
    radius: 40,
    shapeOutline: [
      [-12, -30],
      [12, -30],
      [12, 30],
      [-12, 30],
    ],
  });

  const lamp = () =>
    ({
      localPosition: Vec.create(),
      activationProgress: 1,
      module: new SearchLight({ reach: 200, spread: 30 }),
    }) as import('../../src/client/types').Segment;

  const first = lamp();
  const second = lamp();
  const firstPose = { position: Vec.create(0, -5), rotation: 0 };
  const secondPose = { position: Vec.create(0, 5), rotation: 0 };
  const firstBeam = traceBeam(firstPose, first, [rock]);
  const secondBeam = traceBeam(secondPose, second, [rock]);
  const groups = combineSpectra([
    [first, firstBeam, firstPose],
    [second, secondBeam, secondPose],
  ]);

  assert.equal(
    groups.length,
    1,
    'overlapping parallel slices share one spectrum',
  );
  assert.equal(spectrumOf(groups[0][1]).bands.length, 7);
  assert.equal(runsOf(groups[0][1]).length, 1);

  const nearExtent = (beam: typeof firstBeam, pose: typeof firstPose) => {
    const values = spectrumOf(beam).bands.flatMap(({ path }) =>
      path.vertices
        .slice(0, 9)
        .map(
          ([x, y]) =>
            pose.position.y +
            x * Math.sin(pose.rotation) +
            y * Math.cos(pose.rotation),
        ),
    );

    return [Math.min(...values), Math.max(...values)];
  };

  const firstExtent = nearExtent(firstBeam, firstPose);
  const secondExtent = nearExtent(secondBeam, secondPose);
  const combinedExtent = nearExtent(groups[0][1], groups[0][2]);

  assert.ok(
    combinedExtent[0] <= Math.min(firstExtent[0], secondExtent[0]) + 1e-6,
  );
  assert.ok(
    combinedExtent[1] >= Math.max(firstExtent[1], secondExtent[1]) - 1e-6,
    'the combined rainbow spans both lit slices',
  );
  const reversed = combineSpectra([
    [second, secondBeam, secondPose],
    [first, firstBeam, firstPose],
  ]);

  assert.equal(reversed.length, 1);
  assert.deepEqual(
    spectrumOf(reversed[0][1]).bands.map(({ color }) => color),
    spectrumOf(groups[0][1]).bands.map(({ color }) => color),
    'changing craft order keeps the spectrum order',
  );

  const turnedPose = { position: Vec.create(0, -4), rotation: 0.1 };
  const turnedBeam = traceBeam(turnedPose, second, [rock]);

  assert.equal(
    combineSpectra([
      [first, firstBeam, firstPose],
      [second, turnedBeam, turnedPose],
    ]).length,
    1,
    'slightly different displayed angles still share a spectrum',
  );
  let fills = 0;

  const paint = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fill() {
      fills++;
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
  } as unknown as CanvasRenderingContext2D;

  beginSpectra();
  collectSpectrum(paint, first, firstBeam, firstPose);
  collectSpectrum(paint, second, secondBeam, secondPose);
  assert.equal(fills, 0, 'spectra wait until all lamps have been collected');
  endSpectra(paint);
  assert.equal(fills, 7, 'the frame draws one rainbow from both lamps');

  second.activationProgress = 0.6;
  assert.equal(
    combineSpectra([
      [second, secondBeam, secondPose],
      [first, firstBeam, firstPose],
    ])[0][0],
    first,
    'the merged spectrum follows the strongest lamp',
  );
  second.activationProgress = 1;

  const chainPoses = [-20, 0, 20].map((y) => ({
    position: Vec.create(0, y),
    rotation: 0,
  }));

  const chain = chainPoses.map(
    (pose) =>
      [first, traceBeam(pose, first, [rock]), pose] as [
        typeof first,
        typeof firstBeam,
        typeof pose,
      ],
  );

  assert.equal(
    combineSpectra(chain).length,
    1,
    'overlapping sheets combine transitively',
  );
  const bridged = combineSpectra([chain[0], chain[2], chain[1]]);

  assert.equal(
    bridged.length,
    1,
    'a later sheet joins both previously separate groups',
  );
  assert.equal(spectrumOf(bridged[0][1]).bands.length, 7);

  const offsetPose = { position: Vec.create(0, 28), rotation: 0 };
  const offsetBeam = traceBeam(offsetPose, second, [rock]);

  assert.equal(
    combineSpectra([
      [first, firstBeam, firstPose],
      [second, offsetBeam, offsetPose],
    ]).length,
    2,
    'separate slices retain separate spectra',
  );
  const angledPose = { position: Vec.create(10, -43), rotation: 0.5 };
  const angledBeam = traceBeam(angledPose, second, [rock]);

  assert.equal(
    combineSpectra([
      [first, firstBeam, firstPose],
      [second, angledBeam, angledPose],
    ]).length,
    2,
    'different directions retain separate spectra',
  );

  const another = createAsteroid(world, {
    id: 501,
    position: rock.position,
    radius: rock.radius,
    shapeOutline: rock.shapeOutline,
  });

  const otherBeam = traceBeam(secondPose, second, [another]);

  assert.equal(
    combineSpectra([
      [first, firstBeam, firstPose],
      [second, otherBeam, secondPose],
    ]).length,
    2,
    'different asteroids retain separate spectra',
  );

  const gem = new Item(amethyst, { position: Vec.create(140, 0) });
  const filteredFirst = traceBeam(firstPose, first, [rock, gem]);
  const filteredSecond = traceBeam(secondPose, second, [rock, gem]);
  const filtered = combineSpectra([
    [first, filteredFirst, firstPose],
    [second, filteredSecond, secondPose],
  ]);

  assert.equal(filtered.length, 1);
  assert.ok(
    spectrumOf(filtered[0][1]).bands.some(
      ({ color }) => color === amethyst.shades[2],
    ),
    'the merged spectrum still responds to amethyst',
  );

  const blocker = new GameObject({
    position: Vec.create(165, 0),
    radius: 50,
    shapeOutline: [
      [-5, -50],
      [5, -50],
      [5, 50],
      [-5, 50],
    ],
  });

  const blockedFirst = traceBeam(firstPose, first, [rock, blocker]);
  const blockedSecond = traceBeam(secondPose, second, [rock, blocker]);
  const blocked = combineSpectra([
    [first, blockedFirst, firstPose],
    [second, blockedSecond, secondPose],
  ]);
  const rightmost = Math.max(
    ...spectrumOf(blocked[0][1]).bands.flatMap(({ path }) =>
      path.vertices.map(([x]) => x),
    ),
  );

  assert.ok(
    rightmost <= 160.00001,
    'physical objects still cut the merged spectrum',
  );
}

// Two mounted lamps on the same rotated craft must use their separate lens
// positions when the collected rays are moved into a shared frame.
{
  const rotation = 0.4;
  const pose = { position: Vec.create(), rotation };

  const rock = createAsteroid(createWorld(), {
    id: 502,
    position: Vec.create(90 * Math.cos(rotation), 90 * Math.sin(rotation)),
    rotation,
    radius: 40,
    shapeOutline: [
      [-12, -30],
      [12, -30],
      [12, 30],
      [-12, 30],
    ],
  });

  const makeLamp = (y: number) =>
    ({
      localPosition: Vec.create(0, y),
      activationProgress: 1,
      module: new SearchLight({ reach: 200, spread: 30 }),
    }) as import('../../src/client/types').Segment;

  const lamps = [makeLamp(-5), makeLamp(5)];
  let fills = 0;

  const paint = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    fill() {
      fills++;
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
  } as unknown as CanvasRenderingContext2D;

  beginSpectra();
  lamps.forEach((lamp) =>
    collectSpectrum(paint, lamp, traceBeam(pose, lamp, [rock]), pose),
  );
  endSpectra(paint);
  assert.equal(fills, 7, 'the two mounted lights produce a single spectrum');
}

// Amethyst changes the light from its entry point onward without bending it.
// A later opaque body still stops it, and a rock still makes a spectrum.
{
  const ship = { position: Vec.create(), rotation: 0 };

  const lamp = {
    localPosition: Vec.create(),
    activationProgress: 1,
    module: new SearchLight({ reach: 100, spread: 20 }),
  } as import('../../src/client/types').Segment;

  const gem = new Item(amethyst, { position: Vec.create(30, 0) });
  const block = new Item(diamond, { position: Vec.create(70, 0) });

  const rock = createAsteroid(createWorld(), {
    position: Vec.create(70, 0),
    radius: 15,
    shapeOutline: [
      [-10, -12],
      [10, -12],
      [10, 12],
      [-10, 12],
    ],
  });

  for (const rotation of [0, 0.3, 1.1]) {
    gem.rotation = rotation;
    const open = traceBeam(ship, lamp, [gem]);
    const center = open.rays[32];

    assert.equal(center.filterColor, amethyst.shades[2]);
    assert.ok(center.filterAt && center.filterAt.x < gem.position.x);
    assert.ok(center.at.x > 100 && Math.abs(center.at.y) < 1e-8);
    assert.ok(filteredPaths(open).has(amethyst.shades[2]));

    const stopped = traceBeam(ship, lamp, [gem, block]).rays[32];

    assert.equal(stopped.filterColor, amethyst.shades[2]);
    assert.ok(stopped.at.x < block.position.x);
    assert.equal(stopped.out, undefined);
    assert.ok(traceBeam(ship, lamp, [gem, rock]).rays[32].out?.away);
  }

  const hidden = traceBeam(ship, lamp, [
    block,
    new Item(amethyst, { position: Vec.create(85, 0) }),
  ]);

  assert.equal(hidden.rays[32].filterAt, undefined);
  const afterRock = new Item(amethyst, { position: Vec.create(75, 0) });
  const spectrum = spectrumOf(traceBeam(ship, lamp, [rock, afterRock]));

  assert.ok(
    spectrum.bands.some(({ color }) => color === amethyst.shades[2]),
    'amethyst also filters a spectrum',
  );

  const narrow = {
    rays: [
      { at: Vec.create(100, -1) },
      {
        at: Vec.create(100, 0),
        filterAt: Vec.create(80, 0),
        filterColor: amethyst.shades[2],
      },
      { at: Vec.create(100, 1) },
    ],
  } as import('../../src/client/utilities/prism').Beam;

  assert.ok(
    filteredPaths(narrow).has(amethyst.shades[2]),
    'a gem covering one ray still filters light',
  );
}

// Physical outlines and circles stop the beam, including when their displayed
// pose differs from simulation. Nonphysical fixtures and buried items do not.
{
  const ship = { position: Vec.create(), rotation: 0 };

  const lamp = {
    localPosition: Vec.create(),
    activationProgress: 1,
    module: new SearchLight({ reach: 100, spread: 30 }),
  } as import('../../src/client/types').Segment;

  const rock = createAsteroid(createWorld(), {
    position: Vec.create(70, 0),
    radius: 10,
    shapeOutline: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
  });

  const item = new Item(diamond, { position: Vec.create(35, 0) });
  const center = (beam: ReturnType<typeof traceBeam>) => beam.rays[32];

  const blocked = traceBeam(ship, lamp, [rock, item]);

  assert.ok(center(blocked).at.x < 35);
  assert.equal(center(blocked).out, undefined);
  const moved = traceBeam(
    ship,
    lamp,
    [rock, item],
    undefined,
    new Map([[item.id, { position: Vec.create(35, 40), rotation: 0 }]]),
  );

  assert.ok(
    center(moved).out?.away,
    'a displayed item away from the beam leaves the rock lit',
  );

  const circle = new GameObject({ position: Vec.create(30, 0), radius: 5 });

  assert.ok(center(traceBeam(ship, lamp, [circle])).at.x < 30);
  circle.physics = false;
  assert.ok(center(traceBeam(ship, lamp, [circle])).at.x > 100);
  item.buried = true;
  assert.ok(center(traceBeam(ship, lamp, [item])).at.x > 100);

  const fixture = new GameObject({ position: Vec.create(30, 0), radius: 15 });

  fixture.hitbox = () => [
    {
      owner: fixture,
      position: fixture.position,
      rotation: 0,
      radius: 5,
      friction: 0,
      physics: false,
    },
    {
      owner: fixture,
      position: fixture.position,
      rotation: 0,
      radius: 5,
      friction: 0,
      physics: true,
      dockSegment: true,
    },
  ];

  assert.ok(center(traceBeam(ship, lamp, [fixture])).at.x > 100);

  fixture.hitbox = () => [
    {
      owner: fixture,
      position: fixture.position,
      rotation: 0,
      radius: 5,
      friction: 0,
      physics: true,
    },
  ];

  assert.ok(center(traceBeam(ship, lamp, [fixture])).at.x < 30);

  const source = new GameObject({ position: Vec.create(), radius: 50 });

  source.hitbox = () => [
    {
      owner: source,
      position: Vec.create(),
      rotation: 0,
      radius: 5,
      friction: 0,
      physics: true,
    },
    {
      owner: source,
      position: Vec.create(30, 0),
      rotation: 0,
      radius: 5,
      friction: 0,
      physics: true,
    },
  ];

  assert.ok(
    center(traceBeam(ship, lamp, [source], source)).at.x > 20,
    'the lens is not blocked by its housing',
  );
  assert.ok(
    center(traceBeam(ship, lamp, [source], source)).at.x < 30,
    'the rest of the source can still block its beam',
  );
}

{
  const lamp = {
    localPosition: Vec.create(),
    activationProgress: 1,
    module: new SearchLight({ reach: 100, spread: 15 }),
  } as import('../../src/client/types').Segment;

  const rock = createAsteroid(createWorld(), {
    position: Vec.create(40, 0),
    radius: 15,
    shapeOutline: [
      [-10, -12],
      [10, -12],
      [10, 12],
      [-10, 12],
    ],
  });

  const blocker = new GameObject({
    position: Vec.create(70, 0),
    radius: 25,
    shapeOutline: [
      [-5, -20],
      [5, -20],
      [5, 20],
      [-5, 20],
    ],
  });

  const ship = { position: Vec.create(), rotation: 0 };
  const clear = spectrumOf(traceBeam(ship, lamp, [rock]));
  const blocked = spectrumOf(traceBeam(ship, lamp, [rock, blocker]));
  const farthest = (spectrum: typeof clear) =>
    Math.max(
      ...spectrum.bands.flatMap(({ path }) => path.vertices.map(([x]) => x)),
    );

  assert.ok(farthest(clear) > 90);
  assert.ok(
    farthest(blocked) <= 65.00001,
    'physical objects cut the spectrum after it leaves a rock',
  );
}

const joins = (
  last: {
    hit: import('../../src/client/types').ShapeOutline;
    out: { face: number };
  },
  ray: {
    hit: import('../../src/client/types').ShapeOutline;
    out: { face: number };
  },
) => joinFaces(ray.hit, last.out.face, ray.out.face);

// Whole asteroids generate their shape outline from their ID. The prism must see
// that shape before mining creates children with explicit shape outlines.
{
  const asteroid = createAsteroid(createWorld(), {
    id: 10,
    position: Vec.create(40, 0),
    radius: 12,
    pointCount: 7,
  });

  asteroid.scenery = true;

  const lamp = {
    localPosition: Vec.create(),
    activationProgress: 1,
    module: new SearchLight({ reach: 100, spread: 30 }),
  } as import('../../src/client/types').Segment;

  const beam = traceBeam({ position: Vec.create(), rotation: 0 }, lamp, [
    asteroid,
  ]);

  assert.equal(beam.shapeOutlines.length, 1);
  assert.ok(
    beam.rays.some(
      (ray: import('../../src/client/utilities/prism').Beam['rays'][number]) =>
        ray.out?.away,
    ),
  );
  assert.ok(runsOf(beam).length);
  let bands = 0;

  drawSpectrum(
    {
      save() {},
      restore() {},
      fill() {
        bands++;
      },
      createLinearGradient: () => ({ addColorStop() {} }),
    } as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D,
    lamp,
    beam,
  );

  assert.equal(bands, 7);
}

// An invisible seam halfway along the far side of a square. Test the public
// trace/render path: exactly seven band fills, not two separate seven-band fans.
for (const size of [10, 100, 1000]) {
  for (let frame = 0; frame < 120; frame++) {
    const rotation = (frame * Math.PI) / 60;

    const lamp = {
      localPosition: Vec.create(),
      activationProgress: 1,
      module: new SearchLight({ reach: size * 20, spread: size * 2 }),
    } as import('../../src/client/types').Segment;

    const ship = { rotation, position: Vec.create() };

    const rock = createAsteroid(createWorld(), {
      radius: size * 2,
      rotation: rotation + 0.17,
      position: Vec.create(
        size * 4 * Math.cos(rotation),
        size * 4 * Math.sin(rotation),
      ),
      shapeOutline: [
        [-1, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => [x * size, y * size]),
    });

    rock.scenery = true;
    const beam = traceBeam(ship, lamp, [rock]);

    assert.equal(
      runsOf(beam).length,
      1,
      `split at size ${size}, frame ${frame}`,
    );
    let fills = 0;

    drawSpectrum(
      {
        save() {},
        restore() {},
        fill() {
          fills++;
        },
        createLinearGradient: () => ({ addColorStop() {} }),
      } as Partial<CanvasRenderingContext2D> as CanvasRenderingContext2D,
      lamp,
      beam,
    );

    assert.equal(fills, 7);
  }
}

// Face joins in both directions, including the closing edge. Tiny errors must
// not become notches, but a real indentation must remain separate at every size.
for (const size of [0.1, 10, 10000]) {
  for (const bend of [-0.2, -1e-12, 0, 1e-12, 0.2]) {
    const points = [
      [0, 0],
      [1, 0],
      [2, bend],
      [2, 2],
      [0, 2],
    ].map(([x, y]) => [x * size, y * size]);
    const ray = (face: number) => ({ hit: points, out: { face } });

    assert.equal(joins(ray(0), ray(1)), bend > -0.1);
    assert.equal(joins(ray(1), ray(0)), bend > -0.1);
    assert.equal(joins(ray(4), ray(0)), true);
    assert.equal(joins(ray(0), ray(2)), false);
  }
}

console.log(
  'Prism: 360 traced/rendered frames and corner regression cases passed.',
);
