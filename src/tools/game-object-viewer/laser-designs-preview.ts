import { laserDesigns } from './laser-designs';
import { Laser } from '../../client/objects/modules/laser';
import { Ship } from '../../client/objects/ship';
import { GameObject } from '../../client/objects/game-object';
import { game } from '../../client/game';
import { createWorld, addEntity } from '../../client/simulation/world';
import { type ShipSpec } from '../../specs/ships/types';
import { mustang } from '../../specs/ships/mustang';
import { renderingLayers } from '../../specs/rendering-layers';
import * as Vec from '../../client/utilities/vector';

const selected = new URLSearchParams(location.search).get('design');
const container = document.querySelector<HTMLDivElement>('#designs')!;

try {
  laserDesigns.forEach((design, index) => {
    if (selected !== null ? Number(selected) !== index : index < 24) return;
    const card = document.createElement('article');
    const coordinates = design.model.flatMap((part) =>
      part.points.map(([x]) => x),
    );
    const bodyLength = Math.max(...coordinates) - Math.min(...coordinates);

    card.innerHTML = `<h2>${design.name}</h2><p>${design.description}</p>
      <div class="panels">
        <figure><figcaption>IDLE / 9×</figcaption><canvas width="350" height="260"></canvas></figure>
        <figure><figcaption>FIRING + CONTACT / 5×</figcaption><canvas width="490" height="260"></canvas></figure>
        <figure><figcaption>FITTED TO MUSTANG / 2.7×</figcaption><canvas width="330" height="260"></canvas></figure>
      </div><footer>All views use the game renderer. ${design.model.length} solid shapes · ${bodyLength}-unit body · identical beam effect and damage.</footer>`;
    container.append(card);
    const canvases = card.querySelectorAll('canvas');

    canvases.forEach((canvas, panel) => {
      const world = createWorld();
      const isolated = panel !== 2;

      const spec: ShipSpec = isolated
        ? {
            ...mustang,
            initialLoadout: [],
            hullSegments: [
              {
                health: 100,
                core: true,
                points: [
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1],
                ],
                mounts: [[{ x: 0, y: 0, fits: ['laser' as const] }]],
              },
            ],
          }
        : { ...mustang, initialLoadout: [] };

      const ship = addEntity(world, new Ship({ spec, world, playerId: 1 }));

      const module = new Laser({
        shades: design.spec.shades,
        modelShades: design.spec.modelShades,
        model: Laser.createModel(design.spec),
        barrelLength: design.spec.barrelLength,
      });

      ship.fit(
        module,
        ship.mounts.find((mount) => mount.fits.includes(Laser)),
      );

      if (!isolated) {
        ship.fit(
          new Laser({
            shades: design.spec.shades,
            modelShades: design.spec.modelShades,
            model: Laser.createModel(design.spec),
            barrelLength: design.spec.barrelLength,
          }),
          ship.mounts.find(
            (mount) => mount.fits.includes(Laser) && mount.localPosition.y > 0,
          ),
        );
      }

      ship.setModuleActive({ module: Laser, active: true });
      ship.updateModules(module.activationDuration);
      ship.firing = panel === 1;

      if (panel === 1) {
        addEntity(
          world,
          new GameObject({
            world,
            position: Vec.create(90, 0),
            radius: 3,
            health: 100,
          }),
        );
      }

      const ctx = canvas.getContext('2d')!;
      const scale = panel === 0 ? 9 : panel === 1 ? 5 : 2.7;

      game.ctx = ctx;
      game.scale = scale;
      ctx.save();
      ctx.translate(panel === 0 ? 12 : panel === 1 ? 12 : 145, 130);
      ctx.scale(scale, scale);
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = '#263443';
      ctx.beginPath();
      ctx.moveTo(-60, 0);
      ctx.lineTo(100, 0);
      ctx.stroke();

      if (isolated) {
        ctx.lineWidth = 3;
        ship
          .segmentsAtMount(module.mount)
          .forEach((segment) => module.render({ segment, craft: ship }));
      } else {
        ship.render({ zIndex: renderingLayers.modulesBelowShipHull });
        ship.render({ zIndex: renderingLayers.shipHull });
      }

      if (panel === 1) {
        ctx.strokeStyle = '#91a4b8';
        ctx.lineWidth = 1 / scale;
        ctx.beginPath();
        ctx.arc(90, 0, 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    });
  });

  document.documentElement.dataset.ready = 'true';
} catch (error) {
  document.querySelector('#error')!.textContent =
    error instanceof Error ? error.message : 'Rendering failed';
  throw error;
}
