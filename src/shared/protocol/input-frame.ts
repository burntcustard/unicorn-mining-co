import { type PlayerInput } from './input';

/* Input held at the start of a tick, followed by its timed transitions. */
export interface InputFrame {
  input: PlayerInput;
  changes: { input: PlayerInput; offset: number }[];
}
