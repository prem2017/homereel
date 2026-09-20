import { useState, useEffect, useRef } from 'react';
import { checkSubtitleRef } from '../services/api';

/**
 * The Subscene ID box: what has been typed, and whether it leads anywhere.
 *
 * Two questions, and a regex can only answer one of them. The *shape* - digits,
 * no spaces, not a whole URL pasted in - is free and immediate. Whether the id
 * exists needs the site, and it is worth the trip: `/subtitle/12345` is a real
 * page for The Matrix in Serbian that carries no downloadable file at all, so
 * the shape says yes and the download then fails. A well-formed id is not a
 * working one, and the only honest way to light the button green is to ask.
 *
 * The check is the same fetch and the same predicate the download uses, so green
 * means Get will work rather than "this looks plausible".
 */
export type SubsceneIdState =
  /** Nothing typed yet. */
  | 'empty'
  /** Not the shape of an id - a URL, or a space in it. */
  | 'bad'
  /** Well-formed but too short to be worth asking about. */
  | 'short'
  /** Asking the site. */
  | 'checking'
  /** The site has a subtitle at this id. Get is on. */
  | 'good'
  /** The site answered, and there is nothing to download there. */
  | 'missing'
  /** The configured address is not answering at all - a different problem from
   *  a bad id, and fixed by editing .env rather than by typing another number. */
  | 'unreachable'
  /** The check itself could not run. Get is on anyway - see below. */
  | 'unchecked'
  /** No address is set, so there is nothing to type into. */
  | 'off';

/**
 * Real ids are seven digits. Anything shorter is a prefix of one still being
 * typed, and asking about it is a request that could only ever fail - on someone
 * else's server, once per keystroke.
 */
export const MIN_CHECKED_LENGTH = 5;

// Long enough that a typed id is finished, short enough that a pasted one lights
// up straight away.
const DEBOUNCE_MS = 450;

// The same shape SAFE_ID in server/subtitles/providers/subscene.js enforces. The
// server still checks; this only saves a round trip.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The part that needs no network, kept separate so it can be tested. */
export const shapeOf = (raw: string): 'empty' | 'bad' | 'short' | 'ok' => {
  const value = raw.trim();
  if (!value) return 'empty';
  if (!SAFE_ID.test(value)) return 'bad';
  return value.length < MIN_CHECKED_LENGTH ? 'short' : 'ok';
};

export const useSubsceneId = (enabled: boolean) => {
  const [value, setValue] = useState('');
  const [state, setState] = useState<SubsceneIdState>('empty');
  const [detail, setDetail] = useState<string | null>(null);

  // Answers arrive out of order once someone types past a pause. Only the newest
  // question is allowed to set the verdict.
  const askedRef = useRef(0);

  useEffect(() => {
    const id = value.trim();
    const shape = shapeOf(id);
    setDetail(null);

    // Said before anything is typed, not after. Finding out that a control is
    // dead only once you have used it is the exact failure this box already had.
    if (!enabled) { setState('off'); return; }
    if (shape !== 'ok') { setState(shape); return; }

    setState('checking');
    const asked = ++askedRef.current;
    const timer = window.setTimeout(() => {
      checkSubtitleRef('subscene', id).then(
        (found) => {
          if (asked !== askedRef.current) return;
          if (found.ok) {
            setState('good');
            setDetail(found.title || null);
            return;
          }
          setState(found.unreachable ? 'unreachable' : 'missing');
          setDetail(found.reason || 'No subtitle to download at that ID.');
        },
        (e: unknown) => {
          if (asked !== askedRef.current) return;
          // The check could not run - the site is down, or the address in .env is
          // wrong. That is not a verdict on the id, so Get stays available: a
          // probe failing must not take a working feature with it.
          setState('unchecked');
          setDetail(e instanceof Error ? e.message : 'Could not check that ID.');
        }
      );
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [value, enabled]);

  return { value, setValue, state, detail };
};
