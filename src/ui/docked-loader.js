let dockedUi;
let loading;

const loadDockedUi = () => loading ||= import('./docked').then((module) => dockedUi = module);

export const renderDocked = (game, ship) => {
  if (dockedUi) return dockedUi['renderDocked'](game, ship);
  loadDockedUi();
};

export const moveSelection = (delta, ship) => loadDockedUi().then((module) =>
  module['moveSelection'](delta, ship));

export const moveSubSelection = (delta, ship) => loadDockedUi().then((module) =>
  module['moveSubSelection'](delta, ship));

export const back = (ship) => loadDockedUi().then((module) => module['back'](ship));

export const confirmSelection = (ship) => loadDockedUi().then((module) =>
  module['confirmSelection'](ship));
