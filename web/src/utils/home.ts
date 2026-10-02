import type { FileNode } from '../types';
import { isPlayable, nextPlayable, folderOf } from './siblings';
import { fullTitleOf, labelOf, seriesOf, tidyName } from './mediaLabel';
import { recentlyPlayed, isResumable } from './resume';
import { formatTime } from './time';

/**
 * What the Home screen shows, worked out from the library and the stores the
 * player writes. Pure, so each row can be tested without a DOM; Home.tsx only
 * draws it.
 */
export interface HomeCard {
  /** What pressing the card plays. */
  node: FileNode;
  title: string;
  /** The line under it: "1:28 left", "Next episode", "3 tracks · added today". */
  detail: string;
  /** 0-1 for a progress bar, 0 for none. */
  fraction: number;
  /** A picture from the folder, as a media path, if there is one. */
  art?: string;
}

/** Folder path -> its poster or cover, for every folder that has one. */
export const folderArt = (nodes: FileNode[], into: Map<string, string> = new Map()): Map<string, string> => {
  for (const node of nodes) {
    if (node.type !== 'directory') continue;
    if (node.art) into.set(node.path, node.art);
    if (node.children) folderArt(node.children, into);
  }
  return into;
};

/** A file's own picture, else the nearest folder above it that has one - a
 *  season folder's episodes use the show's poster. */
export const artFor = (node: FileNode, art: Map<string, string>): string | undefined => {
  if (node.art) return node.art;
  let folder = folderOf(node.path).replace(/\/$/, '');
  while (folder) {
    const found = art.get(folder);
    if (found) return found;
    folder = folder.lastIndexOf('/') === -1 ? '' : folder.slice(0, folder.lastIndexOf('/'));
  }
  return undefined;
};

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "today", "yesterday", "3 days ago", "last week", "in May". */
export const addedAgo = (mtime: number, now: number): string => {
  const days = Math.floor((now - mtime) / DAY);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  const date = new Date(mtime);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `in ${MONTHS[date.getMonth()]}${sameYear ? '' : ` ${date.getFullYear()}`}`;
};

const timeLeft = (position: number, duration: number | undefined) =>
  duration && isFinite(duration) && duration > position
    ? `${formatTime(duration - position)} left · from ${formatTime(position)}`
    : `from ${formatTime(position)}`;

/** The show an episode belongs to, or the file itself: one card per show. */
const showKey = (node: FileNode) => seriesOf(node) || node.path;

/**
 * Continue watching: what the player would resume, most recent first, then the
 * next episode of each show whose last-watched episode was finished.
 *
 * "Next" skips what is watched or already in progress, and a show that already
 * has a card - so a series reads as one place to carry on from.
 */
export const continueCards = (
  tree: FileNode[],
  files: Map<string, FileNode>,
  positions: Array<[string, number]>,
  durations: Map<string, number>,
  watched: Map<string, number>,
  art: Map<string, string>,
  limit: number,
): HomeCard[] => {
  const cards: HomeCard[] = recentlyPlayed(files, positions, durations, limit).map(item => ({
    node: item.node,
    title: fullTitleOf(item.node),
    detail: timeLeft(item.position, durations.get(item.node.path)),
    fraction: item.fraction,
    art: artFor(item.node, art),
  }));

  const shows = new Set(cards.map(card => showKey(card.node)));
  const inProgress = new Set(positions.filter(([path, at]) => isResumable(at, durations.get(path))).map(([path]) => path));
  const finished = Array.from(watched.entries()).sort((a, b) => b[1] - a[1]);
  for (const [path] of finished) {
    if (cards.length >= limit) break;
    const done = files.get(path);
    if (!done || done.info?.episode === undefined) continue;
    const next = nextPlayable(tree, path);
    if (!next || watched.has(next.path) || inProgress.has(next.path) || shows.has(showKey(next))) continue;
    shows.add(showKey(next));
    const label = labelOf(next);
    cards.push({
      node: next,
      title: fullTitleOf(next),
      detail: `Next episode${label.title !== `Episode ${next.info?.episode}` ? ` · ${label.title}` : ''}`,
      fraction: 0,
      art: artFor(next, art),
    });
  }
  return cards;
};

/**
 * The newest arrivals. An album is one card and so is a show's new episodes -
 * a season copied in at once would otherwise be the whole row. Pressing a group
 * starts its first unwatched file, in library order.
 */
export const recentlyAddedCards = (
  nodes: FileNode[], watched: Map<string, number>, art: Map<string, string>, limit: number, now: number,
): HomeCard[] => {
  const groups = new Map<string, FileNode[]>();
  const visit = (list: FileNode[]) => {
    for (const node of list) {
      if (node.type === 'directory') { if (node.children) visit(node.children); continue; }
      if (!isPlayable(node) || !node.mtime) continue;
      // A song by its album folder, an episode by its show (seasons together).
      const key = node.mimeType?.startsWith('audio/') ? `album:${folderOf(node.path)}`
        : node.info?.episode !== undefined ? `show:${seriesOf(node) || folderOf(node.path)}`
        : node.path;
      const group = groups.get(key);
      if (group) group.push(node); else groups.set(key, [node]);
    }
  };
  visit(nodes);

  const newest = (group: FileNode[]) => Math.max(...group.map(n => n.mtime || 0));
  return Array.from(groups.values())
    .sort((a, b) => newest(b) - newest(a))
    .slice(0, limit)
    .map((group): HomeCard => {
      const first = group.find(n => !watched.has(n.path)) || group[0];
      const when = `added ${addedAgo(newest(group), now)}`;
      if (group.length === 1) {
        return { node: first, title: fullTitleOf(first), detail: when.charAt(0).toUpperCase() + when.slice(1), fraction: 0, art: artFor(first, art) };
      }
      const audio = first.mimeType?.startsWith('audio/');
      const folder = folderOf(first.path).replace(/\/$/, '');
      const title = audio ? folder.slice(folder.lastIndexOf('/') + 1) : (seriesOf(first) || tidyName(folder));
      return {
        node: first, title, detail: `${group.length} ${audio ? 'tracks' : 'episodes'} · ${when}`, fraction: 0, art: artFor(first, art),
      };
    });
};

export interface BrowseTile {
  folder: FileNode;
  detail: string;
  art?: string;
}

/** One tile per top-level folder that holds any media, with what is in it. */
export const browseTiles = (nodes: FileNode[]): BrowseTile[] => {
  const count = (list: FileNode[], into = { videos: 0, songs: 0 }) => {
    for (const node of list) {
      if (node.type === 'directory') count(node.children || [], into);
      else if (isPlayable(node)) into[node.mimeType!.startsWith('audio/') ? 'songs' : 'videos'] += 1;
    }
    return into;
  };
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return nodes
    .filter(node => node.type === 'directory')
    .map(folder => ({ folder, ...count(folder.children || []) }))
    .filter(({ videos, songs }) => videos + songs > 0)
    .map(({ folder, videos, songs }) => ({
      folder,
      detail: [videos ? plural(videos, 'video') : '', songs ? plural(songs, 'song') : ''].filter(Boolean).join(' · '),
      art: folder.art,
    }));
};
