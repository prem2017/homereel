import type { FileNode } from '../types';

/**
 * How a media file is named on screen: the part that differs between
 * neighbours first, and the rest as chips beside it.
 *
 * Built from what the server read out of the name (`FileNode.info`), and only
 * ever shown: paths, row ids and search keep using the raw file name.
 */
export interface MediaLabel {
  /** "Episode 2 · Pilot", "Big Buck Bunny", "Nocturne in E-flat major". */
  title: string;
  /** "S01E02", for an episode that has a season. */
  marker?: string;
  /** Left out when the folder it sits in already says it. */
  year?: number;
  resolution?: string;
  /** A song's number on its album. */
  track?: number;
  /** What a TV most often refuses, when the name says so: "HEVC", "MKV". */
  risk?: string;
  /** The show, for an episode - its folder's name where that is the show's. */
  series?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/** Dots and underscores read as spaces, the extension dropped. */
export const tidyName = (name: string) =>
  withoutExtension(name).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The folders a path sits in, outermost first. */
export const foldersOf = (path: string) => path.split('/').slice(0, -1);

// Folders named for a season rather than for a show.
const SEASON_FOLDER = /^(season|series|saison|staffel|temporada|stagione)\s*\d+$|^s\d{1,2}$|^specials$/i;

// A parsed "title" that is only the episode's own label - "Episode 1.mp4",
// "S01E01.mp4" - and so says nothing about the show.
const EPISODE_ONLY = /^(episode|ep|e)\s*\d+$|^s\d+\s*e\d+$/i;

// Compared without accents or punctuation: the file says "Legendes" where its
// folder says "Légendes".
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '');

const RISKY_CODEC = /(^|[^a-z0-9])(hevc|[xh]\.?265)([^a-z0-9]|$)/i;

/** "Season 1" for a folder that is one, or null. */
export const seasonOf = (folderName: string): number | null => {
  const match = /(\d+)$/.exec(folderName);
  return SEASON_FOLDER.test(folderName) && match ? Number(match[1]) : null;
};

/**
 * The show an episode belongs to. The nearest folder that is not a season
 * folder, when it names the show - accents and all, which the file name has
 * usually lost - and the parsed title otherwise ("TV/Breaking.Bad.S01E01.mkv"
 * sits in "TV", which is not the show).
 */
export const seriesOf = (node: FileNode): string | undefined => {
  const info = node.info;
  if (!info || info.episode === undefined) return undefined;
  const folders = foldersOf(node.path).filter(f => !SEASON_FOLDER.test(f));
  const nearest = folders.length > 0 ? folders[folders.length - 1] : undefined;
  if (EPISODE_ONLY.test(info.title)) return nearest;
  if (nearest) {
    const a = plain(nearest);
    const b = plain(info.title);
    if (a && b && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return nearest;
  }
  return info.title;
};

export const labelOf = (node: FileNode): MediaLabel => {
  const info = node.info;
  const ext = /\.([a-z0-9]+)$/i.exec(node.name);
  const risk = RISKY_CODEC.test(withoutExtension(node.name)) || info?.codec === 'h265' ? 'HEVC'
    : ext && ext[1].toLowerCase() === 'mkv' ? 'MKV' : undefined;

  if (!info) return { title: tidyName(node.name), risk };
  if (info.track !== undefined) return { title: info.title, track: info.track, risk };

  if (info.episode !== undefined) {
    return {
      title: `Episode ${info.episode}${info.episodeTitle ? ` · ${info.episodeTitle}` : ''}`,
      marker: info.season !== undefined ? `S${pad(info.season)}E${pad(info.episode)}` : undefined,
      resolution: info.resolution,
      series: seriesOf(node),
      risk,
    };
  }

  const folders = foldersOf(node.path);
  const parent = folders.length > 0 ? folders[folders.length - 1] : '';
  const year = info.year && parent.indexOf(String(info.year)) === -1 ? info.year : undefined;
  return { title: info.title || tidyName(node.name), year, resolution: info.resolution, risk };
};

/**
 * One line naming a file anywhere it is seen out of its folder - Home, Up next,
 * the lock screen: "Le Bureau des Légendes · S01E02", "Big Buck Bunny (2008)".
 */
export const fullTitleOf = (node: FileNode): string => {
  const label = labelOf(node);
  const info = node.info;
  if (info?.episode !== undefined) {
    const which = label.marker || `Episode ${info.episode}`;
    return label.series ? `${label.series} · ${which}` : label.title;
  }
  return info?.year ? `${label.title} (${info.year})` : label.title;
};
