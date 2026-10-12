import characters from 'virtual:font-characters';

export const fontText = (text: string) =>
  Array.from(text, (character) =>
    character === ' ' || characters.includes(character) ? character : '□',
  ).join('');
