import { ui, type Screen } from './ui';
import { type Ship } from '../../objects/ship';

type DockedModule = (typeof import('./docked'))['default'];
let loaded: DockedModule;
let loading: Promise<void>;
let dockedScreen: Screen;
let wanted = false;

const open = () => {
  if (!wanted || ui.current || !loaded) return;
  dockedScreen = loaded.createDocked();
  ui.push(dockedScreen);
};

export const syncDockedUi = ({
  ship,
  available,
}: {
  ship: Ship;
  available: boolean;
}) => {
  wanted = available && Boolean(ship.dockedTo) && !ship.launchRequested;

  if (!wanted && dockedScreen && ui.current === dockedScreen) {
    ui.back();
    dockedScreen = undefined;
  }

  if (!wanted || ui.current) return;

  if (loaded) open();
  else {
    loading ||= import('./docked')
      .then(({ default: module }) => {
        loaded = module;
        open();
      })
      .catch(() => {
        loading = undefined;
      });
  }
};
