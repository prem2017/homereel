import { describe, it, expect, vi } from 'vitest';
import { safePlay, fullscreenElement } from './media';

// The reference TV returns undefined from play(); modern browsers return a promise.
const fakeVideo = (play: () => unknown) => ({ play } as unknown as HTMLMediaElement);

describe('safePlay', () => {
    it('does not throw when play() returns undefined, as it does on Chromium 47', () => {
        // The exact regression: `video.play().catch(...)` threw
        // "Cannot read property 'catch' of undefined" and blanked the whole app.
        expect(() => safePlay(fakeVideo(() => undefined))).not.toThrow();
    });

    it('still calls play()', () => {
        const play = vi.fn(() => undefined);
        safePlay(fakeVideo(play));
        expect(play).toHaveBeenCalledOnce();
    });

    it('swallows a rejected promise instead of leaving it unhandled', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => { });
        const denied = Promise.reject(new Error('NotAllowedError'));

        expect(() => safePlay(fakeVideo(() => denied))).not.toThrow();
        await denied.catch(() => { }); // let the internal handler run

        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });

    it('passes a resolved promise through without complaint', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => { });
        safePlay(fakeVideo(() => Promise.resolve()));
        await Promise.resolve();

        expect(log).not.toHaveBeenCalled();
        log.mockRestore();
    });
});

describe('fullscreenElement', () => {
    const element = {} as Element;
    const fakeDocument = (fields: object) => fields as unknown as Document;

    it('reads the prefixed property, which is all Chromium 47 has', () => {
        // The unprefixed one arrived in Chrome 71. Checking only that is how the
        // TV's Back key stopped leaving fullscreen.
        expect(fullscreenElement(fakeDocument({ webkitFullscreenElement: element }))).toBe(element);
    });

    it('reads the standard property, and is null when nothing is fullscreen', () => {
        expect(fullscreenElement(fakeDocument({ fullscreenElement: element }))).toBe(element);
        expect(fullscreenElement(fakeDocument({ fullscreenElement: null, webkitFullscreenElement: null }))).toBeNull();
    });
});
