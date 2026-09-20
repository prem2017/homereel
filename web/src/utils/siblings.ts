import type { FileNode } from '../types';
import { subtitleMatchesVideo } from './subtitleNaming';

/** The folder a path sits in, trailing slash included, `''` at the library root. */
export const folderOf = (filePath: string) => filePath.slice(0, filePath.lastIndexOf('/') + 1);

export const isSubtitleFile = (name: string) => /\.(srt|vtt)$/i.test(name);

export const isPlayable = (node: FileNode) => node.type === 'file'
  && (!!node.mimeType?.startsWith('video/') || !!node.mimeType?.startsWith('audio/'));

/**
 * A subfolder that exists only to hold subtitles - "Subs", "Subtitles", and
 * whatever else the release that built it happened to call the thing.
 *
 * Recognised by what is in it rather than by its name: it holds at least one
 * subtitle and no media at all. A list of names would miss the spellings nobody
 * thought of, and the content test is what makes descending safe at all -
 * walking into *every* subfolder would let a folder of films, each in its own
 * directory with its own subtitles, pour all of them into the menu of a video
 * sitting beside them. A directory with a video in it is some other video's
 * business.
 */
const isSubtitleFolder = (node: FileNode) => node.type === 'directory'
  && !!node.children
  && node.children.some(child => child.type === 'file' && isSubtitleFile(child.name))
  && !node.children.some(isPlayable);

/** The subtitles held in dedicated subtitle folders directly inside `nodes`. */
const nestedSubtitles = (nodes: FileNode[]): FileNode[] => {
  const found: FileNode[] = [];
  for (const node of nodes) {
    if (!isSubtitleFolder(node)) continue;
    for (const child of node.children!) {
      if (child.type === 'file' && isSubtitleFile(child.name)) found.push(child);
    }
  }
  return found;
};

/**
 * The files the player should weigh up alongside `targetPath`: everything in the
 * same folder, `targetPath` included, plus the subtitles sitting in any
 * dedicated subtitle folder beside it.
 *
 * `nodes` is a flat array at every level (the server does not wrap the media
 * root in its own directory node), so a file at the top of the library is a
 * top-level entry in `nodes` rather than a child of one - the check below has
 * to run at each level, not only inside a directory's children, or a video
 * with no parent folder would report zero siblings and its subtitles would
 * never be found.
 *
 * The one level down is not generosity, it is the layout nearly every release
 * ships: one video at the top of its own folder and a `Subs/` next to it. Only
 * *subtitles* are lifted out of it - a video found down there would otherwise
 * join the next/previous rotation of a folder it is not in.
 */
export const findSiblings = (nodes: FileNode[], targetPath: string): FileNode[] => {
  if (nodes.some(node => node.path === targetPath)) return [...nodes, ...nestedSubtitles(nodes)];
  for (const node of nodes) {
    if (node.type === 'directory' && node.children) {
      const found = findSiblings(node.children, targetPath);
      if (found.length > 0) return found;
    }
  }
  return [];
};

/**
 * Which of `siblings` the two Source menus should list while this video plays.
 *
 * A dedicated subtitle folder beside exactly one video can only be about that
 * video, so the folder *is* the association and no name test applies - which is
 * the whole point, because the names inside one are language labels
 * ("kan.srt", "English.srt") rather than copies of the video's name, and every
 * one of them would be rejected. Where such a folder sits beside several videos
 * it is a season's shared Subs, and the normal rules - the episode marker above
 * all - are the only safe reading.
 *
 * Takes the nulls the player actually holds: nothing is playing on the first
 * render, and this project has no strictNullChecks to catch a caller that
 * forgot. Extracted from the component for that reason - it is the one part of
 * the player that can be tested without a DOM.
 */
export const subtitlesFor = (
  siblings: FileNode[],
  filePath: string | null,
  fileName: string | null,
): FileNode[] => {
  // Nothing playing, nothing to offer. Ahead of the rest because the folder
  // rule below does not consult the video's name and so would sail past the
  // empty one that `subtitleMatchesVideo` rejects on its own.
  if (!filePath || !fileName) return [];

  const here = folderOf(filePath);
  const soleVideo = siblings.filter(isPlayable).length === 1;

  return siblings.filter(s => s.type === 'file'
    && isSubtitleFile(s.name)
    && (subtitleMatchesVideo(s.name, fileName)
      || (soleVideo && folderOf(s.path) !== here)));
};
