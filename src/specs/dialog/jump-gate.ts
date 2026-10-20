import type { DialogSpec } from './types';

export const jumpGateDialog = {
  greeting: ['Greetings {player}, traveling to {destination}?'],
  arrival: ['Welcome to {destination}, {player}'],
  accessGranted: ['Access granted. Enter once gate is fully open.'],
  accessPending: ['...'],
  closing: ['Gate closing, stay clear'],
  closingInterrupted: ['Closing interrupted, re-opening'],
  recovery: ["How did you get there {player}? We'll open the gate for you"],
} satisfies DialogSpec;
