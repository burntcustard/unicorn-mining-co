/**
 * The flame out of the back of a thruster nozzle. It grows as the nozzle
 * lights up and is no shape at all while the thruster is off, which is what
 * hides it.
 *
 * @param {Object} segment - `activationProgress` runs 0 to 1 as the nozzle lights
 *   up, and `power` is how much of what it asked for the nozzle is being given.
 * @param {Number} height - Half height of the flare.
 */
export const flare = ({ activationProgress, power }, height) => (activationProgress ?
    [
      [0, -height],
      // Rooted, because a flare cut back in proportion to its power looks far
      // weedier than the thruster behind it is actually working
      [-height * 2.5 * activationProgress * Math.sqrt(power), 0],
      [0, height],
    ] :
    []);
