import { describe, it, expect, beforeEach } from 'vitest';
import { createNumberStore, createStringStore } from './localNumbers';

// A stand-in for localStorage, which the test runner has no reason to provide.
// Pure logic still, and the point of the store is exactly what it does to this
// object - so this is the thing worth asserting on.
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); },
};

describe('createNumberStore', () => {
  beforeEach(() => memory.clear());

  it('reads back what it wrote, and forgets on null', () => {
    const store = createNumberStore('t', 10);
    store.write('a/film.mkv', 12.5);
    expect(store.read('a/film.mkv')).toBe(12.5);

    store.write('a/film.mkv', null);
    expect(store.read('a/film.mkv')).toBeUndefined();
  });

  it('orders entries by when they were last written, not first', () => {
    // This is what "continue watching" reads. Rewriting the first film has to
    // move it to the end, or the list would be ordered by when each film was
    // *started* and the one playing now would sink to the bottom.
    const store = createNumberStore('t', 10);
    store.write('one.mkv', 10);
    store.write('two.mkv', 20);
    store.write('one.mkv', 30);

    expect(store.entries().map(([path]) => path)).toEqual(['two.mkv', 'one.mkv']);
    expect(store.entries()).toEqual([['two.mkv', 20], ['one.mkv', 30]]);
  });

  it('drops the least recently written when full', () => {
    const store = createNumberStore('t', 2);
    store.write('a.mkv', 1);
    store.write('b.mkv', 2);
    store.write('a.mkv', 3);   // a is now the newer of the two
    store.write('c.mkv', 4);

    expect(store.entries().map(([path]) => path)).toEqual(['a.mkv', 'c.mkv']);
  });

  it('survives storage that is unreadable or refuses to write', () => {
    // Private mode, or a full quota. Both callers are conveniences and neither
    // may take playback down with it.
    memory.set('t', 'not json at all');
    const store = createNumberStore('t', 10);
    expect(store.read('a.mkv')).toBeUndefined();
    expect(store.entries()).toEqual([]);

    const original = (globalThis as any).localStorage.setItem;
    (globalThis as any).localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
    expect(() => store.write('a.mkv', 1)).not.toThrow();
    (globalThis as any).localStorage.setItem = original;
  });
});

describe('createStringStore', () => {
  beforeEach(() => memory.clear());

  it('keeps an empty string as a value and deletes only on null', () => {
    // Load-bearing for the subtitle slots: '' is the user having chosen Off for
    // this video, and it has to read back differently from never having chosen -
    // one leaves the slot empty, the other lets the default fill it.
    const store = createStringStore('picks', 10);
    store.write('film.mkv', 'film.en.srt');
    expect(store.read('film.mkv')).toBe('film.en.srt');

    store.write('film.mkv', '');
    expect(store.read('film.mkv')).toBe('');

    store.write('film.mkv', null);
    expect(store.read('film.mkv')).toBeUndefined();
  });

  it('trims by recency like its numeric twin', () => {
    const store = createStringStore('picks', 2);
    store.write('a.mkv', 'a.srt');
    store.write('b.mkv', 'b.srt');
    store.write('a.mkv', 'a2.srt');
    store.write('c.mkv', 'c.srt');

    expect(store.entries()).toEqual([['a.mkv', 'a2.srt'], ['c.mkv', 'c.srt']]);
  });
});
