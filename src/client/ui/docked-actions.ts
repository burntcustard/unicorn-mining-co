import { type Ship } from '../objects/ship';
import { player, unlockPaint, paintUnlocked } from '../player';
import { sendCraftAction } from '../network/craft-actions';
import { moduleTypes } from '../objects/modules';
import { paintColors } from '../../specs/colors';
import { dockedModel, type DockedSelection } from './docked-model';

export const sendAppliedAction = (
  ship: Ship,
  action: Parameters<Ship['applyDockAction']>[0],
) => {
  const applied = ship.applyDockAction(action, player);

  if (applied) sendCraftAction(applied);
  return applied;
};

export const performDockedAction = ({
  ship,
  selection,
  action,
  paint,
}: {
  ship: Ship;
  selection: DockedSelection;
  action: string;
  paint?: number;
}) => {
  const model = dockedModel(ship, selection);
  const { item, mount, hull, cargo } = model;

  if (!ship.dockedTo || !item) return;

  if (action === 'PAINT') {
    if (!model.canPaint || !paintUnlocked(paintColors[paint])) return;

    return sendAppliedAction(ship, {
      action: 'paint',
      paint,
      ...(!hull && {
        moduleId: item.id,
        ...(mount?.module === item && { mount: selection.section }),
      }),
    });
  }

  if (!model.actions.includes(action) || model.disabled(action)) return;

  if (action === 'FIX') {
    return sendAppliedAction(ship, {
      action: 'repair',
      ...(!hull && { moduleId: item.id, mount: selection.section }),
    });
  }

  if (action === 'BUY') {
    return sendAppliedAction(
      ship,
      cargo
        ? { action: 'buyAmmo' }
        : { action: 'buy', module: moduleTypes.indexOf(item) },
    );
  }

  if (action === 'EQUIP') {
    return sendAppliedAction(ship, {
      action: 'equip',
      moduleId: item.id,
      mount: selection.section,
    });
  }

  if (action === 'REMOVE') {
    return sendAppliedAction(ship, {
      action: 'remove',
      mount: selection.section,
    });
  }

  if (action === 'SELL') {
    const objectIds = ship.cargoContents
      .filter((object) => object === item || object.item === item)
      .map((object) => object.id);

    sendCraftAction({ action: 'sell', objectIds });

    if (item.resource === 0) unlockPaint('CYAN', 'DIAMOND SOLD');
  }
};
