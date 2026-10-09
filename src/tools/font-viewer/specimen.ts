/**
 * Keep the whole alphabet visible while its missing glyphs are being drawn.
 * Both cases include every letter; other authored characters follow below.
 */
export function createSpecimens(characters: string[]) {
  const uppercase = 'PACK MY BOX WITH FIVE DANG QUARTZ JEWELS';
  const lowercase = uppercase.toLowerCase();
  const symbols = characters
    .filter(
      (character) =>
        !uppercase.includes(character) && !lowercase.includes(character),
    )
    .join('');

  return { uppercase, lowercase, symbols };
}
