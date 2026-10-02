import { describe, it, expect } from 'vitest';
import { addedAgo, artFor, browseTiles, continueCards, folderArt, recentlyAddedCards } from './home';
import { indexFiles } from './resume';
import type { FileNode } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 2, 12);

const video = (path: string, info: FileNode['info'], mtime = NOW - 100 * DAY): FileNode => ({
  name: path.split('/').pop()!, path, type: 'file', mimeType: 'video/mp4', info, mtime,
});
const song = (path: string, track: number, mtime: number): FileNode => ({
  name: path.split('/').pop()!, path, type: 'file', mimeType: 'audio/flac', info: { title: `Track ${track}`, track }, mtime,
});
const dir = (path: string, children: FileNode[], art?: string): FileNode => ({
  name: path.split('/').pop()!, path, type: 'directory', children, art,
});

const e1 = video('TV/Show/Season 1/Show.S01E01.mp4', { title: 'Show', season: 1, episode: 1 });
const e2 = video('TV/Show/Season 1/Show.S01E02.mp4', { title: 'Show', season: 1, episode: 2 });
const s2e1 = video('TV/Show/Season 2/Show.S02E01.mp4', { title: 'Show', season: 2, episode: 1 }, NOW - 3 * DAY);
const film = video('Films/Sintel (2010)/Sintel.2010.mp4', { title: 'Sintel', year: 2010 }, NOW - 2 * 60 * 60 * 1000);
const tracks = [1, 2, 3].map(n => song(`Music/Album/0${n} - Track.flac`, n, NOW - 10 * DAY));
const TREE: FileNode[] = [
  dir('TV', [dir('TV/Show', [dir('TV/Show/Season 1', [e1, e2]), dir('TV/Show/Season 2', [s2e1])], 'TV/Show/poster.jpg')]),
  dir('Films', [dir('Films/Sintel (2010)', [film], 'Films/Sintel (2010)/poster.jpg')]),
  dir('Music', [dir('Music/Album', tracks, 'Music/Album/cover.jpg')]),
  dir('Empty', [{ name: 'notes.txt', path: 'Empty/notes.txt', type: 'file', mimeType: 'text/plain' }]),
];
const FILES = indexFiles(TREE);
const ART = folderArt(TREE);

describe('continueCards', () => {
  it('lists what would be resumed, with the time left', () => {
    const cards = continueCards(TREE, FILES, [[film.path, 600]], new Map([[film.path, 1800]]), new Map(), ART, 8);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ title: 'Sintel (2010)', detail: '20:00 left · from 10:00', art: 'Films/Sintel (2010)/poster.jpg' });
    expect(cards[0].fraction).toBeCloseTo(1 / 3);
  });

  it('offers the next episode after a finished one, across seasons', () => {
    const watched = new Map([[e1.path, NOW - 2 * DAY], [e2.path, NOW - DAY]]);
    const cards = continueCards(TREE, FILES, [], new Map(), watched, ART, 8);
    expect(cards.map(c => [c.node.path, c.detail])).toEqual([[s2e1.path, 'Next episode']]);
    // The season folder has no poster; the show's is used.
    expect(cards[0].art).toBe('TV/Show/poster.jpg');
  });

  it('does not offer a next episode for a show already being watched', () => {
    const watched = new Map([[e1.path, NOW - DAY]]);
    const cards = continueCards(TREE, FILES, [[e2.path, 300]], new Map([[e2.path, 1200]]), watched, ART, 8);
    expect(cards.map(c => c.node.path)).toEqual([e2.path]);
  });
});

describe('recentlyAddedCards', () => {
  it('puts the newest first, with an album and a season as one card each', () => {
    const cards = recentlyAddedCards(TREE, new Map(), ART, 8, NOW);
    expect(cards.map(c => [c.title, c.detail])).toEqual([
      ['Sintel (2010)', 'Added today'],
      ['Show', '3 episodes · added 3 days ago'],
      ['Album', '3 tracks · added last week'],
    ]);
    expect(cards[2].node).toBe(tracks[0]);
  });

  it('starts a group at its first unwatched file', () => {
    const cards = recentlyAddedCards(TREE, new Map([[e1.path, NOW]]), ART, 8, NOW);
    expect(cards.find(c => c.title === 'Show')!.node).toBe(e2);
  });
});

describe('browseTiles', () => {
  it('counts what each top-level folder holds and skips folders with no media', () => {
    expect(browseTiles(TREE).map(t => [t.folder.name, t.detail])).toEqual([
      ['TV', '3 videos'], ['Films', '1 video'], ['Music', '3 songs'],
    ]);
  });
});

describe('addedAgo', () => {
  it('says how long ago in words', () => {
    expect(addedAgo(NOW - 60 * 1000, NOW)).toBe('today');
    expect(addedAgo(NOW - 1.5 * DAY, NOW)).toBe('yesterday');
    expect(addedAgo(NOW - 9 * DAY, NOW)).toBe('last week');
    expect(addedAgo(NOW - 20 * DAY, NOW)).toBe('2 weeks ago');
    expect(addedAgo(Date.UTC(2025, 4, 1), NOW)).toBe('in May 2025');
  });
});

describe('artFor', () => {
  it('prefers the file\'s own picture', () => {
    expect(artFor({ ...film, art: 'Films/Sintel (2010)/Sintel.2010-poster.jpg' }, ART)).toBe('Films/Sintel (2010)/Sintel.2010-poster.jpg');
    expect(artFor(video('Loose.mp4', { title: 'Loose' }), ART)).toBeUndefined();
  });
});
