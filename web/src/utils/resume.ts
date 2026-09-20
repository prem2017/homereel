import { createNumberStore } from './localNumbers';
import { FileNode } from '../types';

/**
 * Where playback had got to in each file, in seconds.
 *
 * Read back as a `currentTime`, so it stays a plain number of seconds and never
 * becomes a fraction. It lives here rather than inside the player because the
 * library reads it too - a position nothing can see is half a feature.
 */
export const resumeStore = createNumberStore('media-player:resume', 200);

/**
 * How long each of those files turned out to be, learned from `loadedmetadata`.
 *
 * Separate from the position because the pair is what a progress bar needs and
 * the position alone must keep meaning seconds. A file with no entry here is one
 * that has never finished loading its metadata; it simply gets no bar.
 */
export const durationStore = createNumberStore('media-player:duration', 200);

// Resuming into the first or last stretch of a file sends nobody anywhere they
// want to go back to, so the player starts those from the top.
const RESUME_MIN_SECONDS = 30;
const RESUME_TAIL_SECONDS = 30;

/**
 * Whether the player resumes from `position`. One copy for both readers: the
 * library lists what can be resumed and the player resumes it, and two rules is
 * how a row came to say "resume at 0:20" over a file that then played from 0:00.
 */
export const isResumable = (position: number, duration?: number): boolean =>
  position > RESUME_MIN_SECONDS
  && !(duration !== undefined && isFinite(duration) && position >= duration - RESUME_TAIL_SECONDS);

export interface RecentItem {
  node: FileNode;
  /** Seconds in, as it will be resumed. */
  position: number;
  /** 0 when the length is not known, which the caller reads as "draw no bar". */
  fraction: number;
}

/** Every *file* in the tree, by path. Directories are not playable, so not here. */
export const indexFiles = (
  nodes: FileNode[], into: Map<string, FileNode> = new Map(),
): Map<string, FileNode> => {
  for (const node of nodes) {
    if (node.type === 'file') into.set(node.path, node);
    else if (node.children) indexFiles(node.children, into);
  }
  return into;
};

const fractionOf = (position: number, duration: number | undefined): number =>
  duration && duration > 0 ? Math.min(1, position / duration) : 0;

/**
 * What to offer as "continue watching": files with a saved position, most
 * recently played first.
 *
 * `positions` arrives least-recent-first (the store's own order), so this walks
 * it backwards. A path the tree no longer holds is skipped rather than listed
 * and then failing on the press - the file has been deleted, moved, or the media
 * folder has been pointed somewhere else, and none of those are worth an error.
 *
 * So is a position the player would not resume from, except for `playing`: that
 * one is listed from its first seconds, so starting a film visibly lands here.
 */
export const recentlyPlayed = (
  files: Map<string, FileNode>,
  positions: Array<[string, number]>,
  durations: Map<string, number>,
  limit: number,
  playing: string | null = null,
): RecentItem[] => {
  const out: RecentItem[] = [];
  for (let i = positions.length - 1; i >= 0 && out.length < limit; i--) {
    const [path, position] = positions[i];
    const node = files.get(path);
    const duration = durations.get(path);
    if (node && (path === playing || isResumable(position, duration))) {
      out.push({ node, position, fraction: fractionOf(position, duration) });
    }
  }
  return out;
};

/**
 * How far through each file is, for the bars under the library rows.
 *
 * Only files whose length is known appear, so "no entry" and "not started" are
 * the same thing to a caller and both mean nothing is drawn.
 */
export const progressByPath = (
  positions: Array<[string, number]>,
  durations: Map<string, number>,
): Map<string, number> => {
  const out = new Map<string, number>();
  for (const [path, position] of positions) {
    const fraction = fractionOf(position, durations.get(path));
    if (fraction > 0) out.set(path, fraction);
  }
  return out;
};

/** Both stores read together, which is the only way either of them is useful. */
export const readProgress = () => {
  const positions = resumeStore.entries();
  const durations = new Map(durationStore.entries());
  return { positions, durations, progress: progressByPath(positions, durations) };
};
