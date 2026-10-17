import characters from 'virtual:font-characters';

export const fontText = (text: string) =>
  Array.from(text, (character) =>
    character === ' ' ||
    character === '\u2009' ||
    characters.includes(character)
      ? character
      : '□',
  ).join('');
