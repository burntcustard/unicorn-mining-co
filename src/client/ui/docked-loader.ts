import { type GameState } from '../game';
import { type Ship } from '../../shared/craft/ship';

type DockedUi = (typeof import('./docked'))['default'];
let dockedUi: DockedUi | undefined;
let loading: Promise<DockedUi> | undefined;

const loadDockedUi = () =>
  (loading ||= import('./docked').then(
    ({ default: module }) => (dockedUi = module),
  ));

export const renderDocked = (game: GameState, ship: Ship) => {
  if (dockedUi) return dockedUi.renderDocked(game, ship);
  loadDockedUi();
};

export const moveSelection = (delta: number, ship: Ship) =>
  loadDockedUi().then((module) => module.moveSelection(delta, ship, 0));

export const moveSubSelection = (delta: number, ship: Ship) =>
  loadDockedUi().then((module) => module.moveSubSelection(delta, ship));

export const back = (ship: Ship) =>
  loadDockedUi().then((module) => module.back(ship));

export const confirmSelection = (ship: Ship) =>
  loadDockedUi().then((module) => module.confirmSelection(ship));
