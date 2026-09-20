import { describe, it, expect } from 'vitest';
import { parseSubtitleFileName, belongsToVideo, subtitleMatchesVideo } from './subtitleNaming';

describe('parseSubtitleFileName', () => {
  it('reads a name the server wrote', () => {
    expect(parseSubtitleFileName('OS_Ford-V-Ferrari_720p_en1.srt')).toEqual({
      provider: 'OS',
      video: 'Ford-V-Ferrari',
      resolution: '720p',
      language: 'en',
      counter: 1,
      extension: 'srt',
    });
  });

  it('reads one with no resolution segment', () => {
    expect(parseSubtitleFileName('SD_Holiday-in-Rome_fr12.vtt')).toMatchObject({
      video: 'Holiday-in-Rome',
      resolution: null,
      language: 'fr',
      counter: 12,
    });
  });

  it('returns null for a subtitle the user placed themselves', () => {
    // These must not be counted as downloads, or "get me another one" would skip
    // past candidates the user never took.
    for (const name of ['Movie.en.srt', 'Movie.srt', 'subtitles.vtt']) {
      expect(parseSubtitleFileName(name)).toBeNull();
    }
  });
});

describe('belongsToVideo', () => {
  const parsed = (name: string) => parseSubtitleFileName(name)!;

  it('matches the parsed title against the full release name', () => {
    expect(belongsToVideo(
      parsed('OS_Ford-V-Ferrari_1080p_en1.srt'),
      'Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.mkv',
    )).toBe(true);
  });

  it('keeps episodes of one series apart', () => {
    // The whole point of the episode marker in the slug: without this the panel
    // would list episode 1's subtitles while episode 2 is playing.
    expect(belongsToVideo(
      parsed('OS_Au-Service-De-La-France-S01E01_fr1.srt'),
      'Au Service De La France S01E02.mkv',
    )).toBe(false);

    expect(belongsToVideo(
      parsed('OS_Au-Service-De-La-France-S01E02_fr1.srt'),
      'Au Service De La France S01E02.mkv',
    )).toBe(true);
  });

  it('does not match a different film in the same folder', () => {
    expect(belongsToVideo(parsed('OS_The-Matrix_720p_en1.srt'), 'Inception.2010.mkv')).toBe(false);
  });

  it('reads a number in the title as the whole number', () => {
    // "episode1" sits inside "episode10": Episode 1's download was listed, and
    // switched on, while Episode 10 played.
    expect(belongsToVideo(parsed('OS_Episode-1_en1.srt'), 'Episode 10.mp4')).toBe(false);
    expect(belongsToVideo(parsed('OS_Episode-10_en1.srt'), 'Episode 10.mp4')).toBe(true);
    expect(belongsToVideo(parsed('OS_2-Monkeys_720p_en1.srt'), '12.Monkeys.1995.720p.mkv')).toBe(false);
    expect(belongsToVideo(parsed('OS_12-Monkeys_720p_en1.srt'), '12.Monkeys.1995.720p.mkv')).toBe(true);
  });

  it('still matches a title ending in a number when the year follows it', () => {
    // Squashed without care, "300.2006" is one long number.
    expect(belongsToVideo(parsed('OS_300_1080p_en1.srt'), '300.2006.1080p.BluRay.mkv')).toBe(true);
    expect(belongsToVideo(
      parsed('OS_Blade-Runner-2049_1080p_en1.srt'),
      'Blade.Runner.2049.2017.1080p.BluRay.x264.mkv',
    )).toBe(true);
  });
});

describe('subtitleMatchesVideo', () => {
  const EPISODE = 'Le.Bureau.des.Legendes.S01E05.1080p.mkv';

  it('lists a subtitle named after the video file', () => {
    expect(subtitleMatchesVideo('Le.Bureau.des.Legendes.S01E05.1080p.fr.srt', EPISODE)).toBe(true);
  });

  it('lists this episode and hides the others', () => {
    // The reported bug: a season folder offered episode 1's two subtitles while
    // episode 5 was playing.
    expect(subtitleMatchesVideo('OS_Le-Bureau-des-L-gendes-S01E05_fr1.srt', EPISODE)).toBe(true);
    expect(subtitleMatchesVideo('OS_Le-Bureau-des-L-gendes-S01E01_fr1.srt', EPISODE)).toBe(false);
    expect(subtitleMatchesVideo('OS_Le-Bureau-des-L-gendes-S01E01_fr2.srt', EPISODE)).toBe(false);
  });

  it('matches on the episode even when the accents were spelled out differently', () => {
    // "Légendes" parses to the slug "L-gendes", which a file spelling it
    // "Legendes" does not contain - so the slug alone would hide a subtitle that
    // belongs. Both names say S01E05, in the same folder, and that settles it.
    expect(subtitleMatchesVideo('OS_Le-Bureau-des-L-gendes-S01E05_fr1.srt', EPISODE)).toBe(true);
  });

  it('matches the pair a season pack actually leaves on disk', () => {
    // Straight from the folder in the report, where the video keeps its accents
    // and its spaces while the subtitle carries the server's parsed slug. The
    // episode marker is the only thing the two names have in common.
    const video = 'Le Bureau des Légendes S01E01.mkv';
    expect(subtitleMatchesVideo('SS_Le-Bureau-des-L-gendes-S01E01_fr3.srt', video)).toBe(true);
    expect(subtitleMatchesVideo('SS_Le-Bureau-des-L-gendes-S01E02_fr1.srt', video)).toBe(false);
  });

  it('reads 1x05 as an episode marker too', () => {
    expect(subtitleMatchesVideo('Show.1x05.en.srt', 'Show.S01E05.mkv')).toBe(true);
    expect(subtitleMatchesVideo('Show.1x04.en.srt', 'Show.S01E05.mkv')).toBe(false);
  });

  it('hides a subtitle with no episode at all when an episode is playing', () => {
    // In a season folder this is the ambiguous case, and guessing wrong puts the
    // wrong dialogue on screen.
    expect(subtitleMatchesVideo('subtitles.srt', EPISODE)).toBe(false);
  });

  it('keeps Episode 1 and Episode 10 apart when the names carry no season marker', () => {
    // "Episode 1" is how "Episode 10" starts, so both the same-name test and the
    // slug test used to say yes.
    expect(subtitleMatchesVideo('OS_Episode-1_en1.srt', 'Episode 10.mp4')).toBe(false);
    expect(subtitleMatchesVideo('Episode 10.en.srt', 'Episode 1.mp4')).toBe(false);
    expect(subtitleMatchesVideo('OS_Episode-1_en1.srt', 'Episode 1.mp4')).toBe(true);
    expect(subtitleMatchesVideo('Episode 1.en.srt', 'Episode 1.mp4')).toBe(true);
    expect(subtitleMatchesVideo('300.en.srt', '300.mkv')).toBe(true);
  });

  it('still matches films by title', () => {
    const film = 'Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.mkv';
    expect(subtitleMatchesVideo('OS_Ford-V-Ferrari_1080p_en1.srt', film)).toBe(true);
    expect(subtitleMatchesVideo('OS_The-Matrix_720p_en1.srt', film)).toBe(false);
  });

  it('matches nothing when no video is open', () => {
    expect(subtitleMatchesVideo('OS_Ford-V-Ferrari_1080p_en1.srt', '')).toBe(false);
  });
});
