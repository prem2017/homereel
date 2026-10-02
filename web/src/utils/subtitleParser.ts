
export interface VTTCue {
  start: number;
  end: number;
  text: string;
}

// Hours are optional in WebVTT ("01:02.500" is a minute and two seconds), and SRT
// uses a comma before the milliseconds where VTT uses a dot. One pattern for both
// slots: the overlay's own copy once required hours, so a VTT file the bottom
// slot played perfectly showed nothing at all on top.
const TIMESTAMP_SOURCE = '(?:(\\d{1,3}):)?(\\d{1,2}):(\\d{2})[.,](\\d{3})';
const TIMESTAMP = new RegExp(TIMESTAMP_SOURCE, 'g');

// A cue's timing line. Any run of whitespace around the arrow, or none - the
// browser accepts both, so a file written with two spaces must not parse to
// nothing here. Whatever follows the end time (VTT cue settings) is ignored.
const TIMING_LINE = new RegExp(`^${TIMESTAMP_SOURCE}\\s*-->\\s*${TIMESTAMP_SOURCE}`);

const toSeconds = (h: string | undefined, m: string, s: string, ms: string): number =>
  (Number(h) || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

// ASS override codes - {\an8}, {\i1} - which files converted from ASS keep.
// Neither the browser nor the overlay draws them, so both would print them.
const ASS_CODES = /\{\\[^}]*\}/g;

const formatTimestamp = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');

  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}.${pad(ms, 3)}`;
};

/** A text line without its ASS codes, or null when that leaves nothing of it. */
const stripCodes = (line: string): string | null => {
  if (line.indexOf('{\\') === -1) return line;
  const stripped = line.replace(ASS_CODES, '');
  return stripped.trim() === '' ? null : stripped;
};

/**
 * Convert SRT or VTT content to a WebVTT Blob URL for the native <track>, moving
 * every cue by `offsetSeconds`.
 *
 * Rewriting the file is how the bottom subtitle gets shifted at all: its timings
 * live inside what the browser parsed, so unlike the top overlay - which is drawn
 * from cues this app holds and can simply look up at a different time - there is
 * nothing to subtract from at display time. Mutating cue.startTime through the
 * TextTrack API would avoid the rebuild, but it means walking every cue while the
 * track is showing, which old Blink does not reliably re-sort.
 *
 * Only lines carrying "-->" are shifted. A timestamp is an ordinary thing to find
 * in dialogue, and rewriting one there would corrupt the subtitle.
 *
 * Text lines lose their ASS codes. A line that was nothing *but* codes goes
 * entirely rather than staying as an empty line, which would end the cue there.
 */
export const toVttBlob = (content: string, offsetSeconds = 0): string => {
  const shift = (line: string) => line.replace(TIMESTAMP, (_whole, h, m, s, ms) => {
    const at = toSeconds(h, m, s, ms);
    // A negative timestamp is not expressible in VTT, so a subtitle dragged
    // earlier than the start of the file piles up at zero rather than vanishing.
    return formatTimestamp(Math.max(0, at + offsetSeconds));
  });

  let vtt = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.includes('-->') ? shift(line) : stripCodes(line)))
    .filter((line): line is string => line !== null)
    .join('\n');

  // Ensure we don't have double headers if someone renamed a vtt to srt
  if (!vtt.trim().startsWith('WEBVTT')) {
      vtt = 'WEBVTT\n\n' + vtt;
  }

  const blob = new Blob([vtt], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
};

/**
 * Parse SRT or VTT text into cues, for the top overlay.
 *
 * The text keeps its <i>/<b>/<u> markup - `cueRuns` turns that into styled runs
 * when it is drawn - but loses ASS codes, which nothing draws.
 *
 * A line that is only a number is an SRT counter when a timing line follows it,
 * and dialogue otherwise: "1984" and "42" are lines people say, and skipping
 * every number dropped them.
 */
export const parseSubtitleText = (content: string): VTTCue[] => {
  const lines = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: VTTCue[] = [];

  let start = 0;
  let end = 0;
  let text: string[] = [];
  let inCue = false;

  const finish = () => {
    if (inCue && text.length > 0) cues.push({ start, end, text: text.join('\n') });
    text = [];
    inCue = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const timing = TIMING_LINE.exec(line);

    if (timing) {
      // A missing blank line between two cues still starts a new one.
      finish();
      start = toSeconds(timing[1], timing[2], timing[3], timing[4]);
      end = toSeconds(timing[5], timing[6], timing[7], timing[8]);
      inCue = true;
    } else if (line === '') {
      finish();
    } else if (inCue) {
      // The next cue's counter, written without the blank line before it.
      if (/^\d+$/.test(line) && i + 1 < lines.length && TIMING_LINE.test(lines[i + 1].trim())) continue;
      const stripped = stripCodes(line);
      if (stripped !== null) text.push(stripped.trim());
    }
    // Outside a cue: the WEBVTT header, counters, NOTE and STYLE blocks.
  }
  finish();

  return cues;
};

/** One stretch of cue text drawn the same way. */
export interface CueRun {
  text: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f',
};

// VTT escapes its own markup characters, and SRT authors borrowed the habit.
const decodeEntities = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name.charAt(0) === '#') {
    const code = name.charAt(1).toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[name.toLowerCase()] || whole;
});

// A tag is a letter straight after "<" or "</" ("<3" is a heart, not a tag), or a
// VTT karaoke timestamp.
const MARKUP = /<(\/?)([a-z][a-z0-9]*)(?:[.\s/][^>]*)?>|<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/gi;

/**
 * Cue text as runs of plain text with italic, bold and underline flags.
 *
 * The bottom slot is drawn by the browser, which reads this markup; the top one
 * is drawn by this app, which printed "<i>Nobody answered.</i>" as it stood.
 * Every other tag - <font>, <c.yellow>, <v Bob> - is dropped and its text kept.
 * The caller builds elements from the runs; nothing here is ever handed to
 * innerHTML.
 */
export const cueRuns = (text: string): CueRun[] => {
  const runs: CueRun[] = [];
  const depth = { i: 0, b: 0, u: 0 };

  const push = (raw: string) => {
    if (!raw) return;
    const run = { text: decodeEntities(raw), italic: depth.i > 0, bold: depth.b > 0, underline: depth.u > 0 };
    const last = runs[runs.length - 1];
    if (last && last.italic === run.italic && last.bold === run.bold && last.underline === run.underline) {
      last.text += run.text;
    } else {
      runs.push(run);
    }
  };

  MARKUP.lastIndex = 0;
  let at = 0;
  for (let match = MARKUP.exec(text); match !== null; match = MARKUP.exec(text)) {
    push(text.slice(at, match.index));
    at = match.index + match[0].length;
    const name = (match[2] || '').toLowerCase();
    if (name === 'i' || name === 'b' || name === 'u') {
      depth[name] = Math.max(0, depth[name] + (match[1] ? -1 : 1));
    }
  }
  push(text.slice(at));

  return runs;
};

// 3. Find the cue showing at `time`, resuming the scan from `fromIndex`.
//
// Playback time normally only moves forward, so carrying on from the previous hit
// turns what would be a full scan of a feature-length file (~1500 cues, several times
// a second) into a step or two. After a seek that assumption no longer holds, so
// callers pass fromIndex 0 and the scan restarts.
export const cueAt = (
    cues: VTTCue[],
    time: number,
    fromIndex: number,
): { index: number; text: string | null } => {
    if (cues.length === 0) return { index: 0, text: null };

    let i = fromIndex;
    // Rewind when the cursor is stale or has overshot - i.e. after a backwards seek.
    if (i < 0 || i >= cues.length || cues[i].start > time) i = 0;
    while (i < cues.length - 1 && cues[i].end < time) i++;

    const cue = cues[i];
    // Gaps between cues are normal, so landing on one that has not started (or has
    // already finished) means nothing should be on screen.
    return { index: i, text: time >= cue.start && time <= cue.end ? cue.text : null };
};
