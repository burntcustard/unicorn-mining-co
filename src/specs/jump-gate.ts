import { colors } from './colors';
import { renderingLayers } from './rendering-layers';
import type { HullSegmentPlan } from '../client/objects/hull-segments';

// Flare ramp-up and fade-out times.
export const jumpGateFlareDurationOuter = 200;
export const jumpGateFlareDurationInner = 200;
// Delay the first thruster ignition after opening or closing begins.
export const jumpGateThrustStartDelay = 300;
// Begin the final thruster fade-out this long before movement ends.
export const jumpGateThrustEndLead = 1000;

export const jumpGateSpec = {
  greetingMessage: 'Greetings {player}, traveling to {destination}?',
  arrivalMessage: 'Welcome to {destination}, {player}',
  accessGrantedMessage: 'Access granted. Enter once gate is fully open.',
  accessPendingMessage: '...',
  closingMessage: 'Gate closing, stay clear',
  closingInterruptedMessage: 'Closing interrupted, re-opening',
  recoveryMessage:
    "How did you get there {player}? We'll open the gate for you",
  // Delay before each gate access response.
  accessResponseDelay: 3000,
  // Overall gate radius, also used to keep it open while ships are nearby.
  radius: 450,
  // Radius of the gate's portal and circular travel trigger.
  travelRadius: 144,
  // Maximum distance from which a pilot can request gate access.
  approachRadius: 800,
  // Time for the gate hull to move from fully closed to fully open.
  openingDuration: 8000,
  // Time for the gate hull to move from fully open to fully closed.
  closingDuration: 9000,
  // Minimum time spent fully open or closed before another movement can begin.
  stateHoldDuration: 3000,
  // Outward travel distance of each hull half between closed and fully open.
  halfTravel: 189,
  // Safety beams span the gap between the moving halves at these local heights.
  beamOffsets: [-259.5, -225, 225, 259.5],
  beamInset: 7.5,
  // Damage to each ship part pinned between the inward faces of closing halves.
  crushDamage: 1000,
};

// Author the left half in its closed position, then mirror both axes.
const upperPanels = [
  [
    [-259.5, -70.5],
    [-270, -81],
    [-270, -114],
    [-189, -85.5],
  ],
  [
    [-189, -85.5],
    [-189, 0],
    [-259.5, -43.5],
    [-259.5, -70.5],
  ],
  [
    [-189, 0],
    [-270, 0],
    [-270, -33],
    [-259.5, -43.5],
  ],
  [
    [-105, -282],
    [-72, -202.5],
    [-114, -160.5],
    [-129, -160.5],
  ],
  [
    [-147, -142.5],
    [-147, -127.5],
    [-189, -85.5],
    [-270, -114],
  ],
  [
    [-270, -114],
    [-105, -282],
    [-129, -160.5],
    [-147, -142.5],
  ],
  // Beam recesses have 45-degree sides and equal 10.5-unit vertical gaps.
  [
    [-105, -282],
    [0, -282],
    [0, -271.5],
    [-7.5, -264],
    [-7.5, -255],
  ],
  [
    [-7.5, -229.5],
    [-7.5, -220.5],
    [0, -213],
    [0, -202.5],
    [-72, -202.5],
  ],
  [
    [-72, -202.5],
    [-105, -282],
    [-7.5, -255],
    [0, -247.5],
    [0, -237],
    [-7.5, -229.5],
  ],
];

export const jumpGateHull: HullSegmentPlan[] = [-1, 1].flatMap((side) =>
  [-1, 1].flatMap((vertical) =>
    upperPanels.map((points) => ({
      side,
      shades: colors.white,
      zIndex: renderingLayers.stationHull,
      points: points.map(([x, y]) => [x * -side, y * vertical]),
    })),
  ),
);
