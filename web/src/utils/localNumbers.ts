/**
 * A small "path -> value" cache in localStorage.
 *
 * Several things need exactly this - where you had got to in a file, how far a
 * subtitle had to be dragged to line up, which subtitle each slot held - and all
 * of them are conveniences that must never break playback if storage is
 * unavailable. Sharing one implementation keeps the quota trimming and the
 * swallowed errors in a single place.
 */
export interface LocalStore<T> {
  read: (key: string) => T | undefined;
  write: (key: string, value: T | null) => void;
  /**
   * Everything held, least recently written first.
   *
   * The order is the feature: it is what lets "continue watching" list the last
   * few films without a second store keeping timestamps.
   */
  entries: () => Array<[string, T]>;
}

export type NumberStore = LocalStore<number>;

const createStore = <T>(storageKey: string, maxEntries: number): LocalStore<T> => {
  const readAll = (): Record<string, T> => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  };

  return {
    read: (key) => readAll()[key],

    entries: () => {
      const all = readAll();
      return Object.keys(all).map((key): [string, T] => [key, all[key]]);
    },

    write: (key, value) => {
      try {
        const all = readAll();
        // Deleted before it is set again, so a rewrite moves the key to the end
        // rather than staying where it first landed. That makes insertion order
        // *recency* order, which `entries` reads back and which turns the trim
        // below into an ordinary LRU eviction - the file you last watched is now
        // the last thing to be dropped rather than the first.
        delete all[key];
        if (value !== null) all[key] = value;

        // ponytail: keeps the most recent `maxEntries` (ceiling: nowhere near
        // localStorage's ~5MB). Upgrade: IndexedDB if this ever stores more than
        // one primitive per key.
        const keys = Object.keys(all);
        for (let i = 0; i < keys.length - maxEntries; i++) delete all[keys[i]];

        localStorage.setItem(storageKey, JSON.stringify(all));
      } catch {
        // Private mode, or storage is full. Every caller is a convenience; never
        // let one break playback.
      }
    },
  };
};

export const createNumberStore = (storageKey: string, maxEntries: number) =>
  createStore<number>(storageKey, maxEntries);

/**
 * The same store for text. Note `''` is a value like any other and only `null`
 * deletes: an empty string is how "the user chose Off here" is recorded, and it
 * has to read back differently from "the user never chose".
 */
export const createStringStore = (storageKey: string, maxEntries: number) =>
  createStore<string>(storageKey, maxEntries);
