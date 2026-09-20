type DockedUi = typeof import('./docked');
let dockedUi: DockedUi | undefined;
let loading: Promise<DockedUi> | undefined;

const loadDockedUi = () =>
  (loading ||= import('./docked').then((module) => (dockedUi = module)));

export const renderDocked = (game: any, ship: any) => {
  if (dockedUi) return dockedUi['renderDocked'](game, ship);
  loadDockedUi();
};

export const moveSelection = (delta: number, ship: any) =>
  loadDockedUi().then((module) => module['moveSelection'](delta, ship, 0));

export const moveSubSelection = (delta: number, ship: any) =>
  loadDockedUi().then((module) => module['moveSubSelection'](delta, ship));

export const back = (ship: any) =>
  loadDockedUi().then((module) => module['back'](ship));

export const confirmSelection = (ship: any) =>
  loadDockedUi().then((module) => module['confirmSelection'](ship));
