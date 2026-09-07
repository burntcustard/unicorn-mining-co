/**
 * The flame out of the back of a thruster nozzle. It grows as the nozzle
 * lights up and is no shape at all while the thruster is off, which is what
 * hides it.
 *
 * @param {Object} segment - `activationProgress` runs 0 to 1 as the nozzle lights
 *   up or eases back with the throttle.
 * @param {Number} height - Half height of the flare.
 */
export const flare = ({ activationProgress }, height) => (activationProgress ?
    [
      [0, -height],
      [-height * 2.5 * activationProgress, 0],
      [0, height],
    ] :
    []);
