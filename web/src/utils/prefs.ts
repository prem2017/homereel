import { createNumberStore } from './localNumbers';

/**
 * The handful of settings that are set once and expected to stay set.
 *
 * Subtitle size is the one that made this necessary: it is chosen for a room and
 * a screen, not for a film, and having to drag it back to 32px on every reload
 * made a working feature feel broken. Volume, speed and the sidebar are the same
 * kind of thing.
 *
 * Fixed keys rather than paths, so a couple of dozen entries is the whole of it -
 * but it is the same store as the resume positions on purpose, which is what
 * keeps the quota trimming and the "never break playback over storage" handling
 * in one place. Booleans are 1/0: a number store is all that is needed and a
 * second implementation is how the two drift apart.
 */
const store = createNumberStore('media-player:prefs', 40);

export const PREF = {
  volume: 'volume',
  muted: 'muted',
  rate: 'rate',
  topFont: 'top-font',
  bottomFont: 'bottom-font',
  sidebarWidth: 'sidebar-width',
  sidebarOpen: 'sidebar-open',
};

/** The saved value, or `fallback` when there is none or it is unusable. */
export const readPref = (key: string, fallback: number): number => {
  const saved = store.read(key);
  return typeof saved === 'number' && !isNaN(saved) ? saved : fallback;
};

export const writePref = (key: string, value: number): void => store.write(key, value);
