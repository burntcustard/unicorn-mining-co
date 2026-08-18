/**
 * Array of Path2Ds that represent each character.
 *
 * Defined originally as a long string with comma separated values. The string
 * then gets .split() into an array, and then .map()-ed to turn each array
 * element into a Path2D object starting with 'M'.
 *
 * Empty characters (',') are used to make the output array indexes match up
 * with the UTF-16 code units that String.prototype.charCodeAt() returns.
 * @type {Array}
 */
const glyphs = ('' +
  ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,' + // 32 ctrl chars & space
  '5 0 5 9M5 12 5 14,' +                // !
  ',' +                                 // "
  ',' +                                 // #
  '3 1 3 11 5 12 7 11 7 1M0 5 10 5M0 8 10 8,' +  // $
  '1 5 1 2 4 2 4 5ZM2 15 9 0M7 10 10 10 10 13 7 13Z,' + // %
  ',' +                                 // &
  ',' +                                 // '
  '8 0 4 0 4 14 8 14,' +                // (
  '3 0 7 0 7 14 3 14,' +                // )
  ',' +                                 // *
  ',' +                                 // +
  '6 12 4 15,' +                        // ,
  '3 6 8 6,' +                          // -
  ',' +                                 // .
  '2 15 8 0,' +                         // /
  '4 1 8 1 10 7 8 13 4 13 2 7Z,' +      // 0
  '2 4 6 1 6 14,' +                     // 1
  '1 4 6 0 10 4 2 13 11 13,' +          // 2
  '2 0 10 3 6 7 10 11 2 13,' +          // 3
  '6 1 2 10 10 10M6 7 6 14,' +          // 4
  '10 1 3 1 2 7 10 7 8 13 1 13,' +      // 5
  '10 1 5 1 2 13 9 13 9 7 3 7,' +       // 6
  '2 1 10 1 5 14,' +                    // 7
  '2 4 6 0 10 4 2 10 6 14 10 10Z,' +    // 8
  '3 13 8 13 10 1 2 1 3 7 9 7,' +       // 9
  ',' +                                 // :
  ',' +                                 // ;
  ',' + // '10 4 2 8 10 12,' +          // <  // unused
  ',' + // '2 6 10 6M2 10 10 10,' +     // =  // unused
  '2 4 10 8 2 12,' +                    // >
  ',' +                                 // ?
  ',' +                                 // @
  '1 14 5 2 10 14M3 9 8 9,' +           // A
  '3 13 3 1 9 3 9 5 4 7 9 9 9 11Z,' +   // B
  '9 1 5 1 3 3 3 11 5 13 9 13,' +       // C
  '3 13 3 1 7 1 9 4 9 10 7 13Z,' +      // D
  '9 13 3 13 3 1 9 1M3 7 7 7,' +        // E
  '3 14 3 1 9 1M3 7 7 7,' +             // F
  '7 1 2 4 2 11 6 13 9 9 5 9,' +        // G
  '2 14 2 0M9 14 9 0M2 8 9 8,' +        // H
  '3 13 9 13M3 1 9 1M6 13 6 1,' +       // I
  '2 11 6 14 9 11 9 1 4 1,' +           // J
  '3 14 3 0M9 2 4 8 9 14,' +            // K
  '4 0 4 13 9 13,' +                    // L
  '2 14 2 2 6 6 10 2 10 14,' +          // M
  '2 14 2 2 9 12 9 0,' +                // N
  '4 1 8 1 11 7 8 13 4 13 1 7Z,' +      // O
  '3 14 3 1 10 1 9 7 3 7,' +            // P
  '5 1 10 7 5 13 0 7ZM9 13 5 8,' +      // Q
  '3 14 3 1 10 1 9 7 4 7 10 13,' +      // R
  '10 1 3 1 1 7 10 7 8 13 0 13,' +      // S
  '6 14 6 1M2 1 10 1,' +                // T
  '3 0 3 12 6 14 9 12 9 0,' +           // U
  '3 0 3 6 6 13 9 6 9 0,' +             // V
  '1 0 3 12 6 5 9 12 11 0,' +           // W
  '2 0 10 14M10 0 2 14,' +              // X
  '6 14 6 8M2 0 6 8 10 0,' +            // Y
  '1 1 9 1 2 13 10 13'                  // Z
  // We're using normal brackets for square ones to save ~3 bytes
  // '8 0 4 0 4 14 8 14',               // [
  // '8 15 2 0',                        // \
  // '3 0 7 0 7 14 3 14',               // ]
).split(',').map((path) => new Path2D('M' + path));

export function drawText(props) {
  [...props.text.toString().toUpperCase()].forEach((c, i) => {
    const glyph = glyphs[c.charCodeAt(0)];

    // If not the 1st character, translate to be positioned after the 1st
    if (i) {
      props.ctx.translate(13, 0);
    }

    // If glyph found in font, print it
    if (glyph) {
      props.ctx.stroke(glyph);
    }
  });
}

export function renderText(props) {
  const size = props.size || 1;
  let xAlign = 0;
  let yAlign = 0;

  props.ctx.save();
  props.ctx.scale(props.scale, props.scale);

  if (props.alignCenter) {
    yAlign = -6.5 * size;
    xAlign = -props.text.toString().length * 6.5 * size;
  }

  if (props.alignBottom) {
    // Approx height of text
    yAlign = -17 * size;
  }

  if (props.alignRight) {
    // Approx width of text
    xAlign = -props.text.toString().length * 13 * size;
  }

  props.ctx.translate(props.x + xAlign, props.y + yAlign);

  props.ctx.scale(size, size);
  props.ctx.strokeStyle = props.color || '#fff';
  props.ctx.lineWidth = 1.5;
  drawText(props);
  props.ctx.restore();
}
