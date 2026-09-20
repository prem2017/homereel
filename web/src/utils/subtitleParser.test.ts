import { describe, it, expect } from 'vitest';
import { parseSubtitleText, toVttBlob, cueAt, VTTCue } from './subtitleParser';

const SRT = `1
00:00:01,000 --> 00:00:04,500
First line
spanning two rows

2
00:00:06,000 --> 00:00:09,000
Second line
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
First line

00:00:06.000 --> 00:00:09.000
Second line
`;

describe('parseSubtitleText', () => {
    it('parses SRT comma timestamps and keeps multi-row cue text', () => {
        const cues = parseSubtitleText(SRT);
        expect(cues).toHaveLength(2);
        expect(cues[0]).toEqual({ start: 1, end: 4.5, text: 'First line\nspanning two rows' });
        expect(cues[1].start).toBe(6);
    });

    it('parses VTT dot timestamps and skips the header', () => {
        const cues = parseSubtitleText(VTT);
        expect(cues).toHaveLength(2);
        expect(cues[0].text).toBe('First line');
    });

    it('keeps the final cue when the file has no trailing newline', () => {
        const cues = parseSubtitleText('1\n00:00:01,000 --> 00:00:02,000\nOnly cue');
        expect(cues).toHaveLength(1);
        expect(cues[0].text).toBe('Only cue');
    });

    it('handles CRLF line endings', () => {
        const cues = parseSubtitleText(SRT.replace(/\n/g, '\r\n'));
        expect(cues).toHaveLength(2);
        expect(cues[0].text).toBe('First line\nspanning two rows');
    });

    it('returns nothing rather than throwing on junk input', () => {
        expect(parseSubtitleText('not a subtitle file at all')).toEqual([]);
        expect(parseSubtitleText('')).toEqual([]);
    });
});

describe('toVttBlob', () => {
    // Node has Blob but no URL.createObjectURL, so intercept it to read back the
    // content the <track> element would have been handed.
    const withCapturedBlob = (run: () => string): Promise<string> => {
        const captured: Blob[] = [];
        const original = URL.createObjectURL;
        URL.createObjectURL = ((blob: Blob) => {
            captured.push(blob);
            return 'blob:stub';
        }) as typeof URL.createObjectURL;

        try {
            run();
        } finally {
            URL.createObjectURL = original;
        }
        return captured[0].text();
    };

    it('adds the WEBVTT header and converts comma timestamps to dots', async () => {
        const text = await withCapturedBlob(() => toVttBlob(SRT));
        expect(text).toMatch(/^WEBVTT\n\n/);
        expect(text).toContain('00:00:01.000 --> 00:00:04.500');
        expect(text).not.toContain(',500');
    });

    it('does not add a second header to content that already has one', async () => {
        const text = await withCapturedBlob(() => toVttBlob(VTT));
        expect(text.match(/WEBVTT/g)).toHaveLength(1);
    });

    it('shifts every cue by the offset', async () => {
        const text = await withCapturedBlob(() => toVttBlob(SRT, 1.5));
        expect(text).toContain('00:00:02.500 --> 00:00:06.000');
    });

    it('pulls cues earlier on a negative offset, stopping at zero', async () => {
        // A subtitle dragged earlier than the start of the file has nowhere to go:
        // VTT cannot express a negative time, so those cues pile up at 0 rather
        // than making the file unparseable and taking every later cue with them.
        const text = await withCapturedBlob(() => toVttBlob(SRT, -2));
        expect(text).toContain('00:00:00.000 --> 00:00:02.500');
    });

    it('leaves a timestamp in the dialogue alone', async () => {
        // Only lines carrying "-->" are cue timings. Rewriting one inside the text
        // would corrupt the subtitle - and "01:02.500" is a plausible line to say.
        const withText = '1\n00:00:01,000 --> 00:00:04,500\nMeet me at 01:02.500\n';
        const text = await withCapturedBlob(() => toVttBlob(withText, 5));
        expect(text).toContain('Meet me at 01:02.500');
        expect(text).toContain('00:00:06.000 --> 00:00:09.500');
    });

    it('handles VTT timestamps written without an hours field', async () => {
        const short = 'WEBVTT\n\n01:02.500 --> 01:05.000\nHello\n';
        const text = await withCapturedBlob(() => toVttBlob(short, 1));
        expect(text).toContain('00:01:03.500 --> 00:01:06.000');
    });
});

describe('cueAt', () => {
    const cues: VTTCue[] = [
        { start: 0, end: 2, text: 'a' },
        { start: 4, end: 6, text: 'b' },
        { start: 8, end: 10, text: 'c' },
    ];

    it('returns nothing for an empty cue list', () => {
        expect(cueAt([], 5, 0)).toEqual({ index: 0, text: null });
    });

    it('finds the active cue scanning forward', () => {
        expect(cueAt(cues, 5, 0).text).toBe('b');
        expect(cueAt(cues, 9, 0).text).toBe('c');
    });

    it('reports nothing in the gaps between cues', () => {
        expect(cueAt(cues, 3, 0).text).toBeNull();
        expect(cueAt(cues, 7, 1).text).toBeNull();
    });

    it('advances the cursor so the next call starts where this one stopped', () => {
        const first = cueAt(cues, 5, 0);
        expect(first.index).toBe(1);
        // Resuming from that index must still find the right cue.
        expect(cueAt(cues, 9, first.index).text).toBe('c');
    });

    it('rewinds when time jumps backwards, which is what a seek looks like', () => {
        // Cursor parked on the last cue, but playback jumped back to the first.
        expect(cueAt(cues, 1, 2).text).toBe('a');
    });

    it('survives a cursor left past the end of a shorter cue list', () => {
        expect(cueAt(cues, 1, 99).text).toBe('a');
        expect(cueAt(cues, 1, -5).text).toBe('a');
    });

    it('agrees with a naive full scan at every second of the timeline', () => {
        // The cursor is an optimisation; it must not change the answer.
        let cursor = 0;
        for (let t = 0; t <= 12; t += 0.25) {
            const naive = cues.find(c => t >= c.start && t <= c.end)?.text ?? null;
            const result = cueAt(cues, t, cursor);
            cursor = result.index;
            expect(result.text).toBe(naive);
        }
    });
});
