import { describe, it, expect } from 'vitest';
import { indexFiles, recentlyPlayed, progressByPath, isResumable } from './resume';
import { FileNode } from '../types';

const file = (name: string, path: string): FileNode => ({ name, path, type: 'file' });

const TREE: FileNode[] = [
  {
    name: 'Series', path: 'Series', type: 'directory', children: [
      {
        name: 'Bureau', path: 'Series/Bureau', type: 'directory', children: [
          file('S01E01.mkv', 'Series/Bureau/S01E01.mkv'),
          file('S01E02.mkv', 'Series/Bureau/S01E02.mkv'),
        ],
      },
    ],
  },
  file('Ford v Ferrari.mkv', 'Ford v Ferrari.mkv'),
];

describe('indexFiles', () => {
  it('collects files at every depth and no directories', () => {
    const index = indexFiles(TREE);
    expect([...index.keys()].sort()).toEqual([
      'Ford v Ferrari.mkv', 'Series/Bureau/S01E01.mkv', 'Series/Bureau/S01E02.mkv',
    ]);
  });
});

describe('recentlyPlayed', () => {
  const files = indexFiles(TREE);

  it('lists the most recently played first', () => {
    const positions: Array<[string, number]> = [
      ['Ford v Ferrari.mkv', 600],
      ['Series/Bureau/S01E01.mkv', 300],
    ];
    const durations = new Map([['Ford v Ferrari.mkv', 1200], ['Series/Bureau/S01E01.mkv', 3000]]);

    const recent = recentlyPlayed(files, positions, durations, 5);
    expect(recent.map(r => r.node.path)).toEqual(['Series/Bureau/S01E01.mkv', 'Ford v Ferrari.mkv']);
    expect(recent[1].fraction).toBe(0.5);
  });

  it('skips a file the library no longer holds', () => {
    // Deleted, moved, or MEDIA_DIR now points somewhere else. Offering it would
    // put a row on screen that fails the moment it is pressed.
    const positions: Array<[string, number]> = [['Gone.mkv', 30], ['Ford v Ferrari.mkv', 60]];
    const recent = recentlyPlayed(files, positions, new Map(), 5);
    expect(recent.map(r => r.node.path)).toEqual(['Ford v Ferrari.mkv']);
  });

  it('gives a file of unknown length no fraction rather than a wrong one', () => {
    const recent = recentlyPlayed(files, [['Ford v Ferrari.mkv', 60]], new Map(), 5);
    expect(recent[0].fraction).toBe(0);
    expect(recent[0].position).toBe(60);
  });

  it('honours the limit', () => {
    const positions: Array<[string, number]> = [
      ['Ford v Ferrari.mkv', 100], ['Series/Bureau/S01E01.mkv', 100], ['Series/Bureau/S01E02.mkv', 100],
    ];
    expect(recentlyPlayed(files, positions, new Map(), 2)).toHaveLength(2);
  });

  it('offers only what pressing the row would resume, and the file playing', () => {
    // Twenty seconds in, or in the last thirty, the player starts from the top -
    // so a row saying "resume at" there was a promise the press broke.
    const positions: Array<[string, number]> = [
      ['Ford v Ferrari.mkv', 20],
      ['Series/Bureau/S01E01.mkv', 2990],
      ['Series/Bureau/S01E02.mkv', 900],
    ];
    const durations = new Map([['Series/Bureau/S01E01.mkv', 3000], ['Series/Bureau/S01E02.mkv', 3000]]);

    expect(recentlyPlayed(files, positions, durations, 5).map(r => r.node.path))
      .toEqual(['Series/Bureau/S01E02.mkv']);
    // What is playing stays listed from its first seconds, so starting a film
    // visibly lands in the list.
    expect(recentlyPlayed(files, positions, durations, 5, 'Ford v Ferrari.mkv').map(r => r.node.path))
      .toEqual(['Series/Bureau/S01E02.mkv', 'Ford v Ferrari.mkv']);
  });
});

describe('isResumable', () => {
  it('skips the opening and the closing stretch', () => {
    expect(isResumable(20, 3000)).toBe(false);
    expect(isResumable(600, 3000)).toBe(true);
    expect(isResumable(2980, 3000)).toBe(false);
  });

  it('applies only the opening rule while the length is unknown', () => {
    expect(isResumable(600)).toBe(true);
    expect(isResumable(600, Infinity)).toBe(true);
    expect(isResumable(10)).toBe(false);
  });
});

describe('progressByPath', () => {
  it('reports only files whose length is known', () => {
    const progress = progressByPath(
      [['a.mkv', 50], ['b.mkv', 10]],
      new Map([['a.mkv', 200]]),
    );
    expect(progress.get('a.mkv')).toBe(0.25);
    expect(progress.has('b.mkv')).toBe(false);
  });

  it('never reports more than a whole file', () => {
    // A position past the end is possible after a re-encode shortens the file.
    const progress = progressByPath([['a.mkv', 500]], new Map([['a.mkv', 200]]));
    expect(progress.get('a.mkv')).toBe(1);
  });
});
