import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { rolldown } from 'rolldown';
import { buildPlugin, buildPrePlugin } from '../../plugins/build-plugins';
import { stripIfdef } from '../../plugins/replace-pre-terser';

const directory = mkdtempSync(resolve(tmpdir(), 'unicorn-trade-'));
const executable = resolve(directory, 'trade');
const root = process.cwd();

execFileSync('go', ['build', '-o', executable, './src/server/testtools/trade']);

class Socket {
  static OPEN = 1;
  static sockets: Socket[] = [];
  readyState = 1;
  sent: Uint8Array[] = [];

  constructor() {
    Socket.sockets.push(this);
  }

  send(packet: Uint8Array) {
    this.sent.push(packet);
  }
}

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: (): null => null, setItem() {} },
  WebSocket: Socket,
  tradePackets: () => Socket.sockets.at(-1)!.sent.splice(0),
});

const scenario = `
import assert from 'node:assert/strict';
import { NetworkClient } from '${root}/src/client/network/network.ts';
import { applyCraftAction, setCraftActionDispatcher } from '${root}/src/client/network/craft-actions.ts';
import { decodeServerControl } from '${root}/src/client/protocol/binary-control.ts';
import { decodeBinarySnapshot } from '${root}/src/client/protocol/binary-snapshot.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { Module } from '${root}/src/client/objects/modules/module.ts';
import { Laser, moduleTypes } from '${root}/src/client/objects/modules/index.ts';
import { autogunAmmo } from '${root}/src/specs/items/index.ts';

export default async () => {
const server = Reflect.get(globalThis, 'tradeServer');
const outgoing = Reflect.get(globalThis, 'tradePackets');
const client = new NetworkClient({ url: 'test' });
setCraftActionDispatcher((ship, action) => client.applyCraftAction(ship, action));
const render = () => client.updateFrame({ input: emptyPlayerInput(), now: performance.now() + 1, dt: 0 });
const receive = packets => {
  for (const hex of packets) {
    const packet = Uint8Array.from(Buffer.from(hex, 'hex'));
    const message = packet[1] === 0x43 ? decodeServerControl(packet) : decodeBinarySnapshot(packet);
    client.receive({ message });
    render();
  }
};
const flush = async () => receive(await server('receive', outgoing()));
receive(await server('setup', []));
await flush();
const ship = () => client.world.entities.get(client.shipId);
const station = () => client.world.entities.get(ship().dockedTo);
const state = () => [client.player.credits, ship().cargoContents.map(object => object.id), station().cargoContents.map(object => object.id), client.world.nextEntityId];
const act = action => applyCraftAction(ship(), action);
const initial = state();
assert.equal(initial[1].length, 2);
assert.equal(initial[2].length, 300);
const ammoId = station().cargoContents.find(object => object.item === autogunAmmo).id;

// Hold a pre-purchase snapshot until after clicking Buy. It must not undo a
// displayed purchase while its acknowledgement is still in flight.
const old = await server('tick', outgoing());
await server('drift', []);
assert(act({ action: 'buyAmmo' }), 'buyAmmo intent accepted');
assert.equal(ship().cargoContents.length, 3, 'Buy moves stock into cargo before any server response');
assert.equal(station().cargoContents.length, 299);
assert.equal(client.player.credits, initial[0] - autogunAmmo.price, 'Buy updates the balance immediately');
assert.equal(state()[3], initial[3], 'stock transfers allocate no speculative IDs');
const optimisticBuy = state();
receive(old);
assert.deepEqual(state().slice(0, 3), optimisticBuy.slice(0, 3), 'an older snapshot cannot reverse an unconfirmed trade');
await flush();
assert.equal(ship().cargoContents.length, 3);
assert.equal(client.player.credits, initial[0] - autogunAmmo.price);
const ammo = ship().cargoContents.find(object => object.item === autogunAmmo);
assert(ammo && ammo.id === ammoId, 'ammo transfers the actual server stock ID');
assert.equal(station().cargoContents.length, 299, 'purchase depletes station stock');
const confirmedBuy = state();
receive(old);
assert.deepEqual(state(), confirmedBuy, 'a stale acknowledgement cannot undo a confirmed purchase at the same tick');

const afterBuy = state();
assert(act({ action: 'sell', objectIds: [ammo.id] }), 'ammo sell intent accepted');
assert.equal(client.player.credits, initial[0], 'Sell updates credits immediately');
assert.equal(ship().cargoContents.length, afterBuy[1].length - 1, 'Sell removes cargo immediately');
assert.equal(station().cargoContents.length, afterBuy[2].length + 1);
await flush();
assert.equal(client.player.credits, initial[0]);
assert(!ship().cargoContents.some(object => object.id === ammo.id));
assert(station().cargoContents.some(object => object.id === ammo.id));

// A sold module receives a global station ID. Buyback must use that ID,
// even when entities spawned outside the client's interest in the meantime.
const module = ship().cargoContents.find(object => object instanceof Module);
const moduleId = module.id;
const price = module.price;
const beforeSale = state();
await server('drift', []);
assert(act({ action: 'sell', objectIds: [moduleId] }), 'module sell intent accepted');
assert.equal(ship().cargoContents.length, beforeSale[1].length - 1);
assert.equal(client.player.credits, beforeSale[0] + price, 'module sales update immediately');
await flush();
const stock = station().cargoContents.find(object => object instanceof Module);
assert(stock && stock.id !== moduleId, 'module stock uses fresh ID');
assert.equal(client.player.credits, initial[0] + price);
const beforeBuyback = state();
assert(act({ action: 'buyStock', objectIds: [stock.id] }), 'module buyback intent accepted');
assert.equal(ship().cargoContents.length, beforeBuyback[1].length + 1);
assert.equal(client.player.credits, beforeBuyback[0] - price, 'module buyback updates immediately');
await flush();
assert(ship().cargoContents.some(object => object.id === stock.id));
assert(!station().cargoContents.some(object => object.id === stock.id));
assert.equal(client.player.credits, initial[0]);

// Double activation addresses the same stock ID twice. The server transfers
// and charges once; its rejection of the second request leaves that result.
const stockedAmmo = station().cargoContents.find(object => object.id === ammo.id);
assert(stockedAmmo, 'sold ammo remains in stock');
assert(act({ action: 'buyStock', objectIds: [ammo.id] }));
assert.equal(act({ action: 'buyStock', objectIds: [ammo.id] }), undefined, 'duplicate buys are rejected locally');
await flush();
assert.equal(ship().cargoContents.filter(object => object.id === ammo.id).length, 1);
assert.equal(client.player.credits, initial[0] - autogunAmmo.price);
assert(!station().cargoContents.some(object => object.id === ammo.id));
assert(act({ action: 'sell', objectIds: [ammo.id] }));
assert.equal(act({ action: 'sell', objectIds: [ammo.id] }), undefined, 'duplicate sales are rejected locally');
await flush();
assert.equal(client.player.credits, initial[0]);
assert.equal(station().cargoContents.filter(object => object.id === ammo.id).length, 1);

// A snapshot can be batched behind the render loop; applying later deltas
// still retains the accepted sale and never reintroduces the cargo.
await flush();
receive(await server('tick', outgoing()));
assert(!ship().cargoContents.some(object => object.id === ammo.id));
// Keep several requests and their replies in flight. Confirming the first
// must preserve the later local purchase, even within the same server tick.
const beforeRapid = state();
assert(act({ action: 'buyAmmo' }));
const firstReply = await server('receive', outgoing());
assert(act({ action: 'buyAmmo' }));
assert.equal(ship().cargoContents.length, beforeRapid[1].length + 2);
assert.equal(client.player.credits, beforeRapid[0] - 2 * autogunAmmo.price);
receive(firstReply);
assert.equal(ship().cargoContents.length, beforeRapid[1].length + 2, 'a partial acknowledgement retains later purchases');
assert.equal(client.player.credits, beforeRapid[0] - 2 * autogunAmmo.price);
await flush();
assert.equal(ship().cargoContents.length, beforeRapid[1].length + 2);

// Buy back a sold module before any reply, then sell it again. The server's
// global allocation has drifted and none of those temporary references may leak.
const rapidModule = ship().cargoContents.find(object => object instanceof Module);
const rapidModuleId = rapidModule.id;
const rapidBalance = client.player.credits;
await server('drift', []);
assert(act({ action: 'sell', objectIds: [rapidModuleId] }));
assert(station().cargoContents.some(object => object.id === rapidModuleId));
assert(act({ action: 'buyStock', objectIds: [rapidModuleId] }));
assert.equal(client.player.credits, rapidBalance);
assert(act({ action: 'sell', objectIds: [rapidModuleId] }));
assert.equal(client.player.credits, rapidBalance + rapidModule.price);
await flush();
assert(!ship().cargoContents.some(object => object instanceof Module));
const rapidStock = station().cargoContents.find(object => object instanceof Module);
assert(rapidStock && rapidStock.id !== rapidModuleId);
assert.equal(client.player.credits, rapidBalance + rapidModule.price, 'all rapid module trades are accepted using server IDs');

// Backpressure can suppress the direct reply. The next ordinary snapshot
// must carry the changed inventories alongside the transaction acknowledgement.
const beforeBackpressure = state();
await server('block', []);
assert(act({ action: 'buyAmmo' }));
assert(act({ action: 'buyAmmo' }));
await flush();
assert.equal(client.player.credits, beforeBackpressure[0] - 2 * autogunAmmo.price);
assert.equal(ship().cargoContents.length, beforeBackpressure[1].length + 2);
await server('unblock', []);
receive(await server('tick', outgoing()));
assert.equal(ship().cargoContents.length, beforeBackpressure[1].length + 2);
assert.equal(station().cargoContents.length, beforeBackpressure[2].length - 2, 'ordinary snapshot includes the confirmed stock changes');
assert.equal(client.player.credits, beforeBackpressure[0] - 2 * autogunAmmo.price);

// Another player can consume stock before our intent reaches the server.
// Its rejection must remove the optimistic purchase and restore our balance.
const contested = station().cargoContents[0];
const beforeRejection = state();
await server('takeStock', []);
assert(act({ action: 'buyStock', objectIds: [contested.id] }));
assert(ship().cargoContents.some(object => object.id === contested.id));
assert.equal(client.player.credits, beforeRejection[0] - contested.price);
await flush();
assert(!ship().cargoContents.some(object => object.id === contested.id), 'rejection corrects speculative cargo');
assert.equal(client.player.credits, beforeRejection[0], 'rejection restores the balance');
assert.equal(station().cargoContents.length, beforeRejection[2].length - 1);

// Outfitting buys directly into the selected empty mount.
assert(act({ action: 'remove', mount: 0 }));
const beforeLaser = state();
const laser = act({ action: 'buy', module: moduleTypes.indexOf(Laser), mount: 0 });
assert(laser, 'new Beam Laser purchase is accepted');
assert.equal(ship().mounts[0].module.id, laser.moduleId);
assert.equal(ship().mounts[0].health, 40, 'optimistic Beam Laser starts at full health');
assert.deepEqual(state()[1], beforeLaser[1], 'automatic fitting preserves existing cargo');
await flush();
assert.equal(ship().mounts[0].module.id, laser.moduleId, 'server confirms the immediately fitted purchase');
assert.equal(ship().mounts[0].health, 40, 'server confirms full Beam Laser health');
assert.equal(client.player.credits, beforeLaser[0] - Laser.price, 'server charges the purchase once');
assert.deepEqual(state()[1], beforeLaser[1], 'confirmed fitting leaves no extra cargo module');

// Sell directly from the mount with every cargo slot occupied.
while (ship().cargoContents.length < ship().cargoSpace) {
  assert(act({ action: 'buyAmmo' }));
}
await flush();
const fullCargo = state();
const equippedId = ship().mounts[0].module.id;
assert(act({ action: 'sell', objectIds: [equippedId] }));
assert(!ship().mounts[0].module, 'sale immediately clears the mount with full cargo');
assert.deepEqual(state()[1], fullCargo[1], 'optimistic sale preserves full cargo');
await flush();
assert(!ship().mounts[0].module, 'server confirms the direct equipped sale');
assert.deepEqual(state()[1], fullCargo[1], 'confirmed sale needs no extra cargo slot');
assert.equal(client.player.credits, fullCargo[0] + Laser.price, 'equipped sale pays exactly once');
assert(act({ action: 'sell', objectIds: [ship().cargoContents.find(object => object.item === autogunAmmo).id] }));
await flush();

// Rapid buyback and resale must resolve station IDs for equipped sales too.
const soldLaser = station().cargoContents.find(object => object instanceof Laser);
const beforeEquippedBuyback = client.player.credits;
for (let cycle = 0; cycle < 2; cycle++) {
  assert(act({ action: 'buyStock', objectIds: [soldLaser.id] }));
  assert(act({ action: 'equip', moduleId: soldLaser.id, mount: 0 }));
  assert(act({ action: 'sell', objectIds: [soldLaser.id] }));
}
await flush();
assert(!ship().mounts[0].module, 'rapid equipped sales stay sold after server confirmation');
assert.equal(client.player.credits, beforeEquippedBuyback, 'rapid equipped buyback and resale are charged correctly');
assert.equal(ship().cargoContents.length, ship().cargoSpace - 1, 'rapid equipped trades preserve cargo');

const settled = state();
client.connected = false;
assert.equal(act({ action: 'buyAmmo' }), undefined);
assert.deepEqual(state(), settled, 'disconnected clicks cannot invent a purchase');
client.connected = true;
assert.equal(act({ action: 'sell', objectIds: [123456789] }), undefined);
assert.deepEqual(state(), settled, 'invalid cargo leaves both inventories and balance alone');
// Losing the connection before a request arrives restores the last known
// server inventory and balance rather than leaving a phantom purchase visible.
assert(act({ action: 'buyAmmo' }));
assert.equal(ship().cargoContents.length, settled[1].length + 1);
client.socket.onclose({ code: 4001 });
assert.deepEqual(state(), settled, 'disconnect removes unconfirmed trades');
console.log('Real Go session: immediate trades, partial acknowledgements, rapid module buyback, rejections, and disconnected actions passed');
};
`;

try {
  for (const production of [false, true]) {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = createInterface({ input: child.stdout });
    const responses = lines[Symbol.asyncIterator]();

    Reflect.set(
      globalThis,
      'tradeServer',
      async (kind: string, packets: Uint8Array[]) => {
        child.stdin.write(
          JSON.stringify({
            Kind: kind,
            Packets: packets.map((packet) =>
              Buffer.from(packet).toString('hex'),
            ),
          }) + '\n',
        );

        const response = await responses.next();

        assert(!response.done, 'Go session terminated before replying');
        return JSON.parse(response.value);
      },
    );

    const entry = resolve('src/__trade_integration.ts');

    const bundle = await rolldown({
      input: entry,
      external: ['node:assert/strict'],
      plugins: [
        {
          name: 'trade-integration',
          resolveId: (id) => (id === entry ? entry : undefined),
          load(id) {
            if (id === entry) {
              return stripIfdef(
                production
                  ? scenario.replace(
                      /assert\.(\w+)/g,
                      (_, method) => `Reflect.get(assert, '${method}')`,
                    )
                  : scenario,
              );
            }

            if (id.endsWith('/audio/sound-loader.ts')) {
              return 'export const unlockAudio = () => {}; export const playSound = () => {}; export const updateThrusterSound = () => {};';
            }
          },
        },
        buildPrePlugin(),
        ...(production
          ? [{ ...buildPlugin(), generateBundle: undefined }]
          : []),
      ],
    });

    try {
      const { output } = await bundle.generate({
        format: 'esm',
        minify: production,
      });

      const path = resolve(
        directory,
        production ? 'production.mjs' : 'source.mjs',
      );

      writeFileSync(path, output[0].code);
      const test = await import(pathToFileURL(path).href);

      await test.default();
    } finally {
      await bundle.close();
      const closed = once(child, 'exit');

      child.stdin.end();
      await closed;
      lines.close();
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
