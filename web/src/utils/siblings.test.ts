import { describe, it, expect } from 'vitest';
import { findSiblings, folderOf, isPlayable, isSubtitleFile, subtitlesFor } from './siblings';
import type { FileNode } from '../types';

const file = (path: string, mimeType = 'video/mp4'): FileNode => ({
  name: path.split('/').pop()!,
  path,
  type: 'file',
  mimeType,
});

const sub = (path: string) => file(path, 'application/x-subrip');
const other = (path: string) => file(path, 'application/octet-stream');

const dir = (path: string, children: FileNode[]): FileNode => ({
  name: path.split('/').pop()!,
  path,
  type: 'directory',
  children,
});

describe('findSiblings', () => {
  it('finds the siblings of a file nested in a folder', () => {
    const video = file('Movies/Foo.mp4');
    const subtitle = sub('Movies/Foo.srt');
    const tree = [dir('Movies', [video, subtitle])];

    expect(findSiblings(tree, video.path)).toEqual([video, subtitle]);
  });

  it('finds the siblings of a file sitting at the root of the library', () => {
    // The server never wraps the media root in its own directory node, so a
    // video with no parent folder is a top-level entry - the case that used
    // to return no siblings at all, and so no subtitle ever matched it.
    const video = file('Foo.mp4');
    const subtitle = sub('Foo.srt');
    const tree = [video, subtitle];

    expect(findSiblings(tree, video.path)).toEqual([video, subtitle]);
  });

  it('returns nothing for a path that is not in the tree', () => {
    const tree = [file('Foo.mp4')];
    expect(findSiblings(tree, 'Missing.mp4')).toEqual([]);
  });

  it('lifts the subtitles out of a dedicated subtitle folder', () => {
    // The layout nearly every release ships: one video at the top of its own
    // folder, the subtitles a level down in Subs/, named for their language
    // rather than for the film.
    const video = file('Movies/Kantara.2025.1080p.WEBRip-WORLD/Kantara.2025.1080p.mp4');
    const kan = sub('Movies/Kantara.2025.1080p.WEBRip-WORLD/Subs/kan.srt');
    const eng = sub('Movies/Kantara.2025.1080p.WEBRip-WORLD/Subs/kantara.srt');
    const tree = [dir('Movies', [
      dir('Movies/Kantara.2025.1080p.WEBRip-WORLD', [
        video,
        other('Movies/Kantara.2025.1080p.WEBRip-WORLD/Kantara.2025.1080p.mp4.nfo'),
        dir('Movies/Kantara.2025.1080p.WEBRip-WORLD/Subs', [kan, eng]),
      ]),
    ])];

    expect(findSiblings(tree, video.path)).toContain(kan);
    expect(findSiblings(tree, video.path)).toContain(eng);
  });

  it('does not reach into a subfolder that holds a video of its own', () => {
    // The reason the subtitle folder is recognised by content and not by name.
    // Without this, a video loose in Movies/ would collect the subtitles of
    // every film filed beneath it.
    const loose = file('Movies/Trailer.mp4');
    const buried = sub('Movies/Some Other Film/Some Other Film.srt');
    const tree = [dir('Movies', [
      loose,
      dir('Movies/Some Other Film', [file('Movies/Some Other Film/film.mp4'), buried]),
    ])];

    expect(findSiblings(tree, loose.path)).not.toContain(buried);
  });

  it('does not lift a video out of a subfolder', () => {
    // Only subtitles come up. A video down there would join the folder's
    // next/previous rotation while not being in the folder at all.
    const video = file('Show/ep1.mp4');
    const stray = file('Show/Extras/blooper.mp4');
    const tree = [dir('Show', [video, dir('Show/Extras', [stray, sub('Show/Extras/blooper.srt')])])];

    expect(findSiblings(tree, video.path)).not.toContain(stray);
  });
});

describe('subtitlesFor', () => {
  const video = file('Kantara/Kantara.2025.1080p.WEBRip-WORLD.mp4');
  const kan = sub('Kantara/Subs/kan.srt');
  const kantara = sub('Kantara/Subs/kantara.srt');
  const nfo = other('Kantara/Kantara.2025.1080p.WEBRip-WORLD.mp4.nfo');

  it('offers a lone video everything in its Subs folder, whatever it is called', () => {
    expect(subtitlesFor([video, nfo, kan, kantara], video.path, video.name))
      .toEqual([kan, kantara]);
  });

  it('holds the episode line when the Subs folder is shared', () => {
    // Two videos in the folder, so the folder can no longer speak for either -
    // back to the marker, which is the only thing that keeps episode 1's
    // dialogue off episode 5.
    const e1 = file('Show/Show.S01E01.mkv');
    const e5 = file('Show/Show.S01E05.mkv');
    const s1 = sub('Show/Subs/Show.S01E01.en.srt');
    const s5 = sub('Show/Subs/Show.S01E05.en.srt');

    expect(subtitlesFor([e1, e5, s1, s5], e5.path, e5.name)).toEqual([s5]);
  });

  it('still applies the name test inside the folder the video is in', () => {
    // Unchanged behaviour: the loosening is for a dedicated folder only.
    const other1 = sub('Films/The-Matrix.srt');
    const film = file('Films/Inception.2010.mkv');
    expect(subtitlesFor([film, other1], film.path, film.name)).toEqual([]);
  });

  it('answers with nothing when no file is open', () => {
    // The first render of the player, before anything is picked. This threw
    // "Cannot read properties of null" and, with no error boundary above the
    // player, React 18 unmounted the whole app - a blank page, not a bad menu.
    expect(subtitlesFor([video, kan], null, null)).toEqual([]);
  });
});

describe('isPlayable', () => {
  it('accepts video and audio and refuses the rest of a release folder', () => {
    expect(isPlayable(file('a.mp4', 'video/mp4'))).toBe(true);
    expect(isPlayable(file('a.mp3', 'audio/mpeg'))).toBe(true);
    expect(isPlayable(other('a.mp4.nfo'))).toBe(false);
    expect(isPlayable(file('Torrent Downloaded From UIndex.org.txt', 'text/plain'))).toBe(false);
    expect(isPlayable(dir('Subs', []))).toBe(false);
  });
});

describe('isSubtitleFile', () => {
  it('reads the extension whatever its case', () => {
    expect(isSubtitleFile('a.srt')).toBe(true);
    expect(isSubtitleFile('a.VTT')).toBe(true);
    expect(isSubtitleFile('a.mp4')).toBe(false);
  });
});

describe('folderOf', () => {
  it('is empty at the library root', () => {
    expect(folderOf('Foo.mp4')).toBe('');
    expect(folderOf('Movies/Foo.mp4')).toBe('Movies/');
  });
});
