import { describe, it, expect } from 'vitest';
import { highlight, queryWords } from './highlight';

const marked = (text: string, query: string) =>
  highlight(text, queryWords(query)).filter(p => p.hit).map(p => p.text);

describe('highlight', () => {
  it('marks every word of the query, case and accents ignored', () => {
    expect(marked('Le Bureau des Légendes', 'bureau legendes')).toEqual(['Bureau', 'Légendes']);
    expect(marked('Big Buck Bunny', 'BUCK')).toEqual(['Buck']);
  });

  it('keeps the text whole and in order', () => {
    // Inside words too, as the server matches: "des" is also the end of Légendes.
    const pieces = highlight('Le Bureau des Légendes', queryWords('des'));
    expect(pieces.map(p => p.text).join('')).toBe('Le Bureau des Légendes');
    expect(pieces).toEqual([
      { text: 'Le Bureau ', hit: false }, { text: 'des', hit: true },
      { text: ' Légen', hit: false }, { text: 'des', hit: true },
    ]);
  });

  it('marks nothing when nothing matches, and splits queries as the server does', () => {
    expect(marked('Sintel', 'bunny')).toEqual([]);
    expect(queryWords('Le.Bureau  s01e02')).toEqual(['le', 'bureau', 's01e02']);
  });
});
