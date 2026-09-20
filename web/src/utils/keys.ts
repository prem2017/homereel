// Tizen 3.0 - what 2017 Samsung sets (MU6100/MU6125) run - is Chromium 47, which
// predates KeyboardEvent.key (Chrome 51). There `e.key` is undefined, so matching on
// it silently disables every shortcut. keyCode is deprecated on paper but is the only
// field those browsers populate.
//
// The TV remote's media buttons are a second reason: they have no `key` value on any
// browser, only a vendor keyCode. Folding both into one vocabulary means callers can
// switch on a single string.
const KEY_CODES: Record<number, string> = {
    8: 'Backspace',
    13: 'Enter',
    27: 'Escape',
    32: ' ',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',

    // Samsung/Tizen remote. No `key` equivalent exists for these anywhere.
    10009: 'Back',
    10252: 'MediaPlayPause',
    415: 'MediaPlay',
    19: 'MediaPause',
    413: 'MediaStop',
    412: 'MediaRewind',
    417: 'MediaFastForward',
};

/**
 * Canonical name for a key press, working on both modern browsers and Chromium 47.
 * Returns '' for keys we have no name for, which callers can safely ignore.
 *
 * Single characters always come back lower-case, so a caller comparing against 'f'
 * does not have to think about Shift.
 */
export const normalizeKey = (e: KeyboardEvent): string => {
    // keyCode first: it is the only field that carries the remote's media buttons,
    // and for everything in the table above it agrees with `key` on modern browsers.
    const mapped = KEY_CODES[e.keyCode];
    if (mapped) return mapped;

    if (e.key) return e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // No `key` at all, so this is an old browser: derive letters and digits from the
    // ASCII-aligned part of the keyCode range.
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 65 && e.keyCode <= 90) return String.fromCharCode(e.keyCode + 32);

    return '';
};
