/**
 * Where a search's words fall in a piece of text, for marking them in the
 * results: the same comparison the server searches with - accents and case
 * ignored - mapped back onto the text as it is shown. Pure, no DOM.
 */
export interface Piece {
  text: string;
  hit: boolean;
}

// One character as the server's searchKey reads it: accents off, lower case.
const fold = (char: string) => char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words of a query, as the server splits it: anything not a letter or digit separates. */
export const queryWords = (query: string): string[] =>
  query.split(/[\s._\-()[\],:;!?'"/]+/).map(word => Array.from(word).map(fold).join('')).filter(Boolean);

export const highlight = (text: string, words: string[]): Piece[] => {
  if (!text) return [];
  // The folded text, and for each of its characters the index it came from.
  let folded = '';
  const from: number[] = [];
  Array.from(text).forEach((char, at) => {
    const f = fold(char);
    for (let i = 0; i < f.length; i++) { folded += f[i]; from.push(at); }
  });
  const chars = Array.from(text);
  const marked = chars.map(() => false);
  for (const word of words) {
    if (!word) continue;
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      for (let i = at; i < at + word.length; i++) marked[from[i]] = true;
    }
  }
  const pieces: Piece[] = [];
  chars.forEach((char, i) => {
    const last = pieces[pieces.length - 1];
    if (last && last.hit === marked[i]) last.text += char;
    else pieces.push({ text: char, hit: marked[i] });
  });
  return pieces;
};
