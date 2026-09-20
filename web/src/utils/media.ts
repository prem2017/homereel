// Platform shims for the reference TV (2017 Samsung MU6100, Tizen 3.0 ≈ Chromium 47),
// in the same spirit as keys.ts. See the compatibility table in CLAUDE.md.

/**
 * Start playback without assuming play() returns a promise.
 *
 * HTMLMediaElement.play() only began returning a promise in Chrome 50. On the
 * reference TV it returns undefined, so `video.play().catch(...)` threw
 * "Cannot read property 'catch' of undefined" straight out of the effect that
 * starts playback. With no error boundary above it, React unmounted the entire
 * app, so every file you picked went black.
 *
 * Promise.resolve() flattens both shapes: undefined becomes an already-resolved
 * promise, while a real promise passes through and still rejects into the handler
 * on modern browsers.
 */
export const safePlay = (video: HTMLMediaElement): void => {
    Promise.resolve(video.play()).catch(e => console.log('Playback blocked', e));
};

/**
 * The element that is fullscreen, or null.
 *
 * Chromium 47 has only the prefixed properties - the standard one arrived in
 * Chrome 71 - so a bare `document.fullscreenElement` is always undefined on the
 * reference TV. One check written that way is how Back stopped leaving
 * fullscreen there, so every check goes through this.
 */
export const fullscreenElement = (doc: Document = document): Element | null => {
    const d = doc as any;
    return d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement || null;
};
