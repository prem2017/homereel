/**
 * Reading the names the server writes downloaded subtitles under:
 *
 *     <source>_<video>_<resolution>_<language><counter>.<srt|vtt>
 *     OS_Ford-V-Ferrari_1080p_en1.srt
 *
 * The names are the only record of what has already been taken, so this is what
 * lets the panel say "you have three French ones already" and lets the next
 * download skip past them. Nothing here writes a name - `server/subtitles/
 * naming.js` is the only place that does, and this must keep pace with it.
 */
export interface SubtitleFileName {
  provider: string;
  video: string;
  resolution: string | null;
  language: string;
  counter: number;
  extension: string;
}

export const parseSubtitleFileName = (fileName: string): SubtitleFileName | null => {
  const match = /^([A-Za-z0-9]+)_(.+)_([A-Za-z]{2,3})(\d+)\.(srt|vtt)$/i.exec(fileName);
  if (!match) return null;

  const [, provider, middle, language, counter, extension] = match;

  // Greedy above, so the resolution - when there is one - is still on the end of
  // the middle segment.
  const withResolution = /^(.+)_(\d{3,4}[pi])$/i.exec(middle);

  return {
    provider,
    video: withResolution ? withResolution[1] : middle,
    resolution: withResolution ? withResolution[2] : null,
    language: language.toLowerCase(),
    counter: Number(counter),
    extension: extension.toLowerCase(),
  };
};

const isDigit = (char: string) => char >= '0' && char <= '9';

// Lower case with the separators dropped - except between two numbers, where
// dropping them would read "300.2006" as one.
const squash = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  .reduce((out, part) => out + (isDigit(out.charAt(out.length - 1)) && isDigit(part.charAt(0)) ? ' ' : '') + part, '');

// Is `inner` at `outer[at]` as a whole, with no number running on across either
// edge? "episode1" starts "episode10", and "2monkeys" sits inside "12monkeys".
const wholeAt = (outer: string, inner: string, at: number) =>
  !(isDigit(outer.charAt(at - 1)) && isDigit(inner.charAt(0)))
  && !(isDigit(outer.charAt(at + inner.length)) && isDigit(inner.charAt(inner.length - 1)));

/**
 * Does this saved subtitle belong to this video?
 *
 * The slug in the name is the *parsed* title, so it is a fragment of the video's
 * file name rather than all of it - "Ford-V-Ferrari" out of
 * "Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.mkv". Comparing with separators
 * and case stripped is what makes those two meet.
 *
 * Deliberately a containment test and not equality: the client cannot re-derive
 * the title (that parsing lives on the server, where the dependency is), and it
 * does not need to - this only decides which subtitles a menu lists, never
 * anything on disk. Episodes stay apart because the slug carries S01E02, and a
 * number in the slug must be a whole number in the name: Episode 1 is not
 * Episode 10.
 */
export const belongsToVideo = (parsed: SubtitleFileName, videoFileName: string): boolean => {
  const slug = squash(parsed.video);
  const video = squash(videoFileName.replace(/\.[^.]+$/, ''));
  if (slug.length === 0) return false;
  for (let at = video.indexOf(slug); at !== -1; at = video.indexOf(slug, at + 1)) {
    if (wholeAt(video, slug, at)) return true;
  }
  return false;
};

const withoutExtension = (fileName: string) => fileName.replace(/\.[^.]+$/, '');

/**
 * s01e05 out of a name, however it was written: "S01E05", "s01.e05", "1x05".
 *
 * Read from the name as it stands rather than from a squashed copy: squashing
 * runs "S01E05" into the "1080p" behind it, and a greedy episode number then
 * reads that as episode 51. Hence the trailing (?!\d) as well. No lookbehind
 * anywhere - the TVs this targets are Chromium 47.
 */
const episodeMarkerOf = (fileName: string): string | null => {
  const match = /s(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)/i.exec(fileName)
    || /(?:^|[^0-9])(\d{1,2})x(\d{2,3})(?!\d)/i.exec(fileName);
  return match ? `s${Number(match[1])}e${Number(match[2])}` : null;
};

/**
 * Should this subtitle file appear in the menus while this video is playing?
 *
 * A season folder is the case that matters: it holds every episode and, once a
 * few downloads have landed, every episode's subtitles. Listing all of them
 * makes the menu useless - the user is offered episode 1's subtitle while
 * watching episode 5, which is the one thing they cannot want.
 *
 * The episode marker is checked *before* the name slug, and that ordering is the
 * point: the slug comes from the server's parsed title, which turns accented
 * letters into separators ("Légendes" -> "L-gendes"), so a file that spells them
 * out will not contain it. Two names that both say S01E05, in the same folder,
 * are about the same episode whatever the rest of them looks like.
 */
export const subtitleMatchesVideo = (subtitleName: string, videoFileName: string): boolean => {
  if (!videoFileName) return false;

  // A subtitle the user brought themselves, sitting next to its video under the
  // same name. This is the oldest convention there is and it settles the case
  // outright - as long as "Episode 10.en.srt" is not read as starting "Episode 1".
  const base = withoutExtension(videoFileName);
  if (base.length > 0 && subtitleName.startsWith(base) && wholeAt(subtitleName, base, 0)) return true;

  const videoEpisode = episodeMarkerOf(base);
  const subtitleEpisode = episodeMarkerOf(withoutExtension(subtitleName));
  if (videoEpisode || subtitleEpisode) return videoEpisode === subtitleEpisode;

  const parsed = parseSubtitleFileName(subtitleName);
  return parsed !== null && belongsToVideo(parsed, videoFileName);
};
