// Timing is in simulation seconds; distances are in meters.
export const collectorSpec = {
  names: ['Mabel', 'Otis', 'Winnie', 'Bert', 'Cleo', 'Percy', 'Nell', 'Alfie'],
  ship: 'finch',
  operatingRadius: 10_000,
  checkIntervalMin: 120,
  checkIntervalMax: 300,
  discoveryInterval: 1,
  minimumItems: 3,
  nearbyItemRadius: 200,
  launchInterval: 5,
  pickupTimeout: 300,
  arrivalDistance: 30,
  inspectionRange: 80,
  inspectionDistance: 12,
  inspectionDelay: 5,
  inspectionDuration: 10,
  // TODO: Equip shields for collectors in dangerous sectors.
} as const;
