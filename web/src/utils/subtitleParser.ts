
export interface VTTCue {
  start: number;
  end: number;
  text: string;
}

// Helper: Convert Timestamp "00:00:00,000" (SRT) or "00:00:00.000" (VTT) to seconds
const parseTime = (t: string): number => {
  if (!t) return 0;
  const parts = t.replace(',', '.').split(':');
  const secParts = parts[2].split('.');
  return (
    parseInt(parts[0]) * 3600 +
    parseInt(parts[1]) * 60 +
    parseInt(secParts[0]) +
    parseInt(secParts[1]) / 1000
  );
};

// Hours are optional in WebVTT ("01:02.500" is a minute and two seconds), and SRT
// uses a comma before the milliseconds where VTT uses a dot.
const TIMESTAMP = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{3})/g;

const formatTimestamp = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');

  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}.${pad(ms, 3)}`;
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
 * Only lines carrying "-->" are touched. A timestamp is an ordinary thing to find
 * in dialogue, and rewriting one there would corrupt the subtitle.
 */
export const toVttBlob = (content: string, offsetSeconds = 0): string => {
  const shift = (line: string) => line.replace(TIMESTAMP, (whole, h, m, s, ms) => {
    const at = (Number(h) || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    // A negative timestamp is not expressible in VTT, so a subtitle dragged
    // earlier than the start of the file piles up at zero rather than vanishing.
    return formatTimestamp(Math.max(0, at + offsetSeconds));
  });

  let vtt = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.includes('-->') ? shift(line) : line))
    .join('\n');

  // Ensure we don't have double headers if someone renamed a vtt to srt
  if (!vtt.trim().startsWith('WEBVTT')) {
      vtt = 'WEBVTT\n\n' + vtt;
  }

  const blob = new Blob([vtt], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
};

// 2. Parse Subtitle Text (SRT or VTT) into generic Cue Objects (for Custom Overlay)
export const parseSubtitleText = (content: string): VTTCue[] => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const cues: VTTCue[] = [];
  
  // Regex handles both VTT (dot) and SRT (comma) timestamps
  // Match: 00:00:00.000 --> 00:00:00.000
  const timeRegex = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s-->\s(\d{2}:\d{2}:\d{2}[.,]\d{3})/;
  
  let currentStart = 0;
  let currentEnd = 0;
  let currentText: string[] = [];
  let processingCue = false;

  for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip WebVTT header or index numbers usually found in SRT
      if (line === 'WEBVTT' || /^\d+$/.test(line)) {
          continue;
      }

      const match = line.match(timeRegex);
      
      if (match) {
          // If we were processing a previous cue, push it now (safety catch)
          if (processingCue && currentText.length > 0) {
              cues.push({ start: currentStart, end: currentEnd, text: currentText.join('\n') });
              currentText = [];
          }

          currentStart = parseTime(match[1]);
          currentEnd = parseTime(match[2]);
          processingCue = true;
      } else if (line === '') {
          // Empty line usually indicates end of a cue block
          if (processingCue && currentText.length > 0) {
              cues.push({ start: currentStart, end: currentEnd, text: currentText.join('\n') });
              currentText = [];
              processingCue = false;
          }
      } else if (processingCue) {
          currentText.push(line);
      }
  }

  // Push final cue if file doesn't end with newline
  if (processingCue && currentText.length > 0) {
      cues.push({ start: currentStart, end: currentEnd, text: currentText.join('\n') });
  }

  return cues;
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
