import { describe, it, expect } from 'vitest';
import { normalizeKey } from './keys';

// Chromium 47 (Tizen 3.0, 2017 Samsung sets) populates keyCode but not key.
const oldBrowser = (keyCode: number) => ({ keyCode } as KeyboardEvent);
const modern = (key: string, keyCode = 0) => ({ key, keyCode } as KeyboardEvent);

describe('normalizeKey', () => {
    it('reads modern browsers straight from key', () => {
        expect(normalizeKey(modern('ArrowLeft', 37))).toBe('ArrowLeft');
        expect(normalizeKey(modern('Escape', 27))).toBe('Escape');
    });

    it('still works where key is undefined, which is the whole point', () => {
        expect(normalizeKey(oldBrowser(37))).toBe('ArrowLeft');
        expect(normalizeKey(oldBrowser(39))).toBe('ArrowRight');
        expect(normalizeKey(oldBrowser(32))).toBe(' ');
        expect(normalizeKey(oldBrowser(13))).toBe('Enter');
        expect(normalizeKey(oldBrowser(27))).toBe('Escape');
    });

    it('derives letters and digits from keyCode on old browsers', () => {
        expect(normalizeKey(oldBrowser(70))).toBe('f');
        expect(normalizeKey(oldBrowser(77))).toBe('m');
        expect(normalizeKey(oldBrowser(53))).toBe('5');
    });

    it('lower-cases single characters so Shift does not change the meaning', () => {
        expect(normalizeKey(modern('F', 70))).toBe('f');
        expect(normalizeKey(modern('f', 70))).toBe('f');
    });

    it('maps the Samsung remote media buttons, which have no key value anywhere', () => {
        expect(normalizeKey(oldBrowser(415))).toBe('MediaPlay');
        expect(normalizeKey(oldBrowser(19))).toBe('MediaPause');
        expect(normalizeKey(oldBrowser(10252))).toBe('MediaPlayPause');
        expect(normalizeKey(oldBrowser(413))).toBe('MediaStop');
        expect(normalizeKey(oldBrowser(412))).toBe('MediaRewind');
        expect(normalizeKey(oldBrowser(417))).toBe('MediaFastForward');
        expect(normalizeKey(oldBrowser(10009))).toBe('Back');
    });

    it('agrees between old and modern browsers for the same physical key', () => {
        const pairs: Array<[number, string]> = [
            [37, 'ArrowLeft'], [38, 'ArrowUp'], [39, 'ArrowRight'], [40, 'ArrowDown'],
            [13, 'Enter'], [27, 'Escape'], [32, ' '],
        ];
        for (const [code, key] of pairs) {
            expect(normalizeKey(oldBrowser(code))).toBe(normalizeKey(modern(key, code)));
        }
    });

    it('returns empty string for keys it has no name for', () => {
        expect(normalizeKey(oldBrowser(999))).toBe('');
    });
});
