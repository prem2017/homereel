import { readPref, writePref, PREF } from './prefs';

/**
 * Larger text for a TV across a room: the root font size, which every rem-based
 * Tailwind size follows - text and spacing alike. Icons are sized in pixels, so
 * index.css zooms them by the same factor. Remembered in prefs, which live in
 * each browser: the TV keeps large text and the laptop stays as it is.
 * Subtitles keep their own sizes.
 */
export const TEXT_SCALES = [1, 1.25, 1.5];

export const readTextScale = (): number => {
  const saved = readPref(PREF.textScale, 1);
  return TEXT_SCALES.indexOf(saved) === -1 ? 1 : saved;
};

export const applyTextScale = (scale: number): void => {
  try {
    const root = document.documentElement;
    // A percentage of the browser's own default, so a reader's setting is kept.
    root.style.fontSize = scale === 1 ? '' : `${scale * 100}%`;
    root.setAttribute('data-text-scale', String(scale));
  } catch {
    // Nothing to scale; never worth breaking the page over.
  }
};

/** The next size round the cycle, applied and remembered. */
export const cycleTextScale = (current: number): number => {
  const next = TEXT_SCALES[(TEXT_SCALES.indexOf(current) + 1) % TEXT_SCALES.length];
  applyTextScale(next);
  writePref(PREF.textScale, next);
  return next;
};
