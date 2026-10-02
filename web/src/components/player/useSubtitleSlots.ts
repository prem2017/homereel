import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toVttBlob, parseSubtitleText, cueAt, VTTCue } from '../../utils/subtitleParser';
import { createNumberStore, createStringStore, LocalStore } from '../../utils/localNumbers';
import { subtitlesFor } from '../../utils/siblings';
import { getSubtitleTextUrl } from '../../services/api';
import { defaultSubtitle, languageOfSubtitle } from '../../utils/subtitleLabel';
import { FileNode } from '../../types';

// Subtitle sync, keyed by the subtitle's own path rather than the video's: the
// offset belongs to that file, and two subtitles for one film are routinely out
// by different amounts. An offset found by trial and error and then lost on
// reopen would be worse than not having the control at all.
const offsetStore = createNumberStore('media-player:subtitle-offset', 400);

// Which subtitle each slot held, keyed by the *video* - the one thing here that
// is a decision about the film rather than about the room. Picking a file up
// again from "continue watching" and having to choose its two subtitles a second
// time is the moment the app looked like it had forgotten the session.
//
// Only the pick is stored. The sync offset follows from it, because that is
// keyed on the subtitle's own path above, and the font sizes are a preference
// about the screen and are remembered for every file at once.
const topPickStore = createStringStore('media-player:subtitle-top', 200);
const bottomPickStore = createStringStore('media-player:subtitle-bottom', 200);

// The language each slot was last given from its menu ('top', 'bottom'), and the
// one last asked of the download menu ('download'). Not per film: this is what
// lets a film nobody has opened yet start in the right language, and the top
// slot fill itself for someone who watches with two. A pick made for a film
// still wins (`rememberedPick`). '' is a deliberate Off for the top slot.
export const languagePrefs = createStringStore('media-player:subtitle-language', 10);

// The browser's own language, as the bottom slot's preference until a menu says
// otherwise: "en-US" -> "en".
const browserLanguage = (): string | null => {
  try {
    return (navigator.language || '').toLowerCase().split('-')[0] || null;
  } catch {
    return null;
  }
};

export const OFFSET_STEP = 0.5;
export const OFFSET_FINE_STEP = 0.1;
const OFFSET_LIMIT = 60;

// How long to let the buttons settle before rebuilding the bottom track. Each
// rebuild remounts <track> and makes the browser reparse the file, so without
// this a run of taps blanks the subtitle repeatedly.
const OFFSET_COMMIT_MS = 200;

const clampOffset = (value: number) =>
  Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, Math.round(value * 10) / 10));

export type SubtitleSlot = 'top' | 'bottom';

/**
 * The two subtitle slots: what each holds, its text, its sync offset, and what
 * was chosen for this video last time.
 *
 * Top is drawn by this app from cues it holds (`currentTopText`, looked up at
 * `t - topOffset`); bottom is a native <track> built from a rewritten blob
 * (`bottomSubtitleSrc`). Everything here is per video and resets when the video
 * changes; the picks and offsets it records outlive the session.
 */
export const useSubtitleSlots = ({ filePath, fileName, siblings, videoRef }: {
  filePath: string | null;
  fileName: string | null;
  siblings: FileNode[];
  videoRef: React.RefObject<HTMLVideoElement>;
}) => {
  // Subtitle State
  //
  // Which files in this folder are subtitles for *this* video. Derived from the
  // folder listing every render and never copied into state: a download reaches
  // the menus by adding to that listing (see `applySubtitle` in
  // useOnlineSubtitles), and a second copy
  // held here is one the next recompute would throw away. That is precisely what
  // used to happen - a season pack handed nine files up to the folder listing,
  // the recompute fired, and the one file it did not carry was this video's own,
  // the one just downloaded.
  // A season folder holds every episode's subtitles side by side, and offering
  // episode 1's while episode 5 is playing is the one thing a menu must not do.
  // The rule, and the dedicated-Subs-folder case, live in `subtitlesFor`.
  const availableSubtitles = useMemo(
    () => subtitlesFor(siblings, filePath, fileName),
    [siblings, filePath, fileName],
  );

  const [bottomSubtitle, setBottomSubtitle] = useState<FileNode | null>(null);
  const [bottomSubtitleText, setBottomSubtitleText] = useState<string | null>(null);
  const [bottomSubtitleSrc, setBottomSubtitleSrc] = useState<{ url: string; filePath: string | null } | null>(null); // Blob URL, and the file it was built for
  const bottomBlobRef = useRef<string | null>(null);

  const [topSubtitle, setTopSubtitle] = useState<FileNode | null>(null);
  const [currentTopText, setCurrentTopText] = useState<string | null>(null);
  // Cues drive an overlay, never a render of their own, so they live in a ref.
  const topSubCuesRef = useRef<VTTCue[]>([]);
  const cueIndexRef = useRef(0);
  // The last subtitle each slot showed, for the c and t keys to bring back.
  const lastShownRef = useRef<{ top: FileNode | null; bottom: FileNode | null }>({ top: null, bottom: null });

  // Subtitle sync. Two offsets, because the two slots routinely hold subtitles
  // from different sources that are out by different amounts.
  //
  // `appliedBottomOffset` trails `bottomOffset` by a moment: the number on the
  // button updates on the press, while the rebuild of the track waits for the
  // presses to stop. The top overlay needs no such thing - it is a subtraction at
  // lookup time - which is the whole difference between the two paths.
  const [topOffset, setTopOffset] = useState(0);
  const [bottomOffset, setBottomOffset] = useState(0);
  const [appliedBottomOffset, setAppliedBottomOffset] = useState(0);

  // The video on screen now, for replies that land after the one they were asked
  // for - `filePath` inside a callback is the video when the request was made.
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // 1a. Both slots empty when the video changes - and only then. A subtitle that
  // lands mid-playback grows the list without touching what is on screen, which
  // is the difference between "a new file is available" and "you are watching a
  // different film".
  useEffect(() => {
    setTopSubtitle(null);
    setBottomSubtitle(null);
    lastShownRef.current = { top: null, bottom: null };
    topSubCuesRef.current = [];
    cueIndexRef.current = 0;
    setCurrentTopText(null);
  }, [filePath]);

  // What was chosen for this video last time, as a node in *today's* list.
  // Three answers, and they are all different:
  //   a node   - that file, still here
  //   null     - deliberately Off, so leave the slot empty
  //   undefined- never chosen, or chosen and since deleted: fall back
  // The last two collapsing is what makes a subtitle the user has thrown away
  // stop haunting the menus while still letting an explicit Off stick.
  const rememberedPick = useCallback((store: LocalStore<string>): FileNode | null | undefined => {
    if (!filePath) return undefined;
    const path = store.read(filePath);
    if (path === undefined) return undefined;
    if (path === '') return null;
    return availableSubtitles.find(s => s.path === path) || undefined;
  }, [filePath, availableSubtitles]);

  // 1b. Fill the slots once there is something to put in them: last time's
  // choice where there is one, otherwise a default. Everything in the list is
  // this video's; the bottom default is in the preferred language, then named
  // exactly after the file - a subtitle the user placed themselves and so an
  // explicit choice - then the first (`defaultSubtitle`). The top slot fills by
  // default only in a language it was given before.
  //
  // Every branch fills rather than assigns: this runs again when the list grows,
  // and by then the user - or the download that grew it - has already chosen. On
  // a change of video the reset above is queued first, so the updater sees null
  // and this picks the new file's own.
  useEffect(() => {
    const rememberedBottom = rememberedPick(bottomPickStore);
    const bottomChoice = rememberedBottom !== undefined ? rememberedBottom
      : defaultSubtitle(availableSubtitles, fileName, languagePrefs.read('bottom') || browserLanguage());
    setBottomSubtitle(prev => prev || bottomChoice);

    const rememberedTop = rememberedPick(topPickStore);
    // Never the bottom's language twice: two slots are for two languages.
    const topLanguage = languagePrefs.read('top');
    const bottomLanguage = bottomChoice ? languageOfSubtitle(bottomChoice.name) : null;
    const topChoice = rememberedTop !== undefined ? rememberedTop
      : topLanguage && topLanguage !== bottomLanguage
        ? availableSubtitles.find(s => languageOfSubtitle(s.name) === topLanguage) || null
        : null;
    if (topChoice) setTopSubtitle(prev => prev || topChoice);
  }, [availableSubtitles, fileName, rememberedPick]);

  // 2a. Fetch the bottom subtitle's text and keep it. Held rather than converted
  // and dropped, because shifting it means rebuilding the file and refetching for
  // every nudge of the sync buttons would be absurd.
  useEffect(() => {
    if (!bottomSubtitle) {
      setBottomSubtitleText(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getSubtitleTextUrl(bottomSubtitle.path));
        const text = await res.text();
        if (!cancelled) setBottomSubtitleText(text);
      } catch (e) {
        console.error("Failed to load bottom subtitle", e);
      }
    })();

    return () => { cancelled = true; };
  }, [bottomSubtitle]);

  // 2b. Build the track the browser actually reads. Both formats go through this:
  // an unshifted VTT could have been served by URL directly, but keeping one path
  // means the offset cannot work for one format and not the other.
  useEffect(() => {
    // Revoking through a ref, not through state: the old cleanup closed over
    // bottomSubtitleSrc as it was *before* the fetch resolved, so it freed a URL two
    // subtitles old and leaked the one actually in use.
    const revokePrevious = () => {
      if (bottomBlobRef.current) {
        URL.revokeObjectURL(bottomBlobRef.current);
        bottomBlobRef.current = null;
      }
    };

    if (bottomSubtitleText === null) {
      revokePrevious();
      setBottomSubtitleSrc(null);
      return;
    }

    const blobUrl = toVttBlob(bottomSubtitleText, appliedBottomOffset);
    revokePrevious();
    bottomBlobRef.current = blobUrl;
    setBottomSubtitleSrc({ url: blobUrl, filePath: filePathRef.current });
  }, [bottomSubtitleText, appliedBottomOffset]);

  // Free the last blob when the player goes away entirely.
  useEffect(() => () => {
    if (bottomBlobRef.current) URL.revokeObjectURL(bottomBlobRef.current);
  }, []);

  // Each slot's offset follows the file in it, and is remembered per subtitle.
  useEffect(() => {
    const saved = topSubtitle ? offsetStore.read(topSubtitle.path) : undefined;
    setTopOffset(saved || 0);
  }, [topSubtitle]);

  useEffect(() => {
    const saved = bottomSubtitle ? offsetStore.read(bottomSubtitle.path) : undefined;
    setBottomOffset(saved || 0);
    // Straight through rather than debounced: switching subtitle rebuilds the
    // track anyway, so there is nothing to spare.
    setAppliedBottomOffset(saved || 0);
  }, [bottomSubtitle]);

  useEffect(() => {
    if (bottomOffset === appliedBottomOffset) return;
    const timer = window.setTimeout(() => setAppliedBottomOffset(bottomOffset), OFFSET_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [bottomOffset, appliedBottomOffset]);

  // delta 0 means reset. Written out here rather than inside the state updater:
  // React may run an updater twice, and that is not a place for a side effect.
  const nudgeOffset = useCallback((slot: 'top' | 'bottom', delta: number) => {
    const subtitle = slot === 'top' ? topSubtitle : bottomSubtitle;
    if (!subtitle) return;

    const current = slot === 'top' ? topOffset : bottomOffset;
    const next = delta === 0 ? 0 : clampOffset(current + delta);

    (slot === 'top' ? setTopOffset : setBottomOffset)(next);
    // Zero is stored as absent, so a reset leaves nothing behind.
    offsetStore.write(subtitle.path, next === 0 ? null : next);
  }, [topSubtitle, bottomSubtitle, topOffset, bottomOffset]);

  // 3. Process Top Subtitle (Parse for Custom Overlay)
  useEffect(() => {
    if (!topSubtitle) {
      topSubCuesRef.current = [];
      cueIndexRef.current = 0;
      setCurrentTopText(null);
      return;
    }

    let cancelled = false;
    const fetchSub = async () => {
      try {
        const url = getSubtitleTextUrl(topSubtitle.path);
        const res = await fetch(url);
        const text = await res.text();
        if (cancelled) return;
        // Use the universal parser (handles SRT and VTT)
        topSubCuesRef.current = parseSubtitleText(text);
        cueIndexRef.current = 0;
      } catch (e) {
        console.error("Failed to load top subtitle", e);
      }
    };
    fetchSub();
    return () => { cancelled = true; };
  }, [topSubtitle]);

  // Only a deliberate choice is recorded, so "no record" keeps meaning "work it
  // out" - and a default that improves later still applies. The Source menus are
  // that choice, and they also set the slot's language for films to come; the
  // c and t keys record the pick but leave the language alone.
  const chooseSubtitle = useCallback((slot: SubtitleSlot, sub: FileNode | null, setsLanguage = true) => {
    (slot === 'top' ? setTopSubtitle : setBottomSubtitle)(sub);
    if (filePath) (slot === 'top' ? topPickStore : bottomPickStore).write(filePath, sub ? sub.path : '');
    // A file whose name says no language clears the slot's: nothing is known,
    // and an old language kept through a Swap once doubled up English top and
    // bottom on the next film.
    if (setsLanguage) languagePrefs.write(slot, sub ? languageOfSubtitle(sub.name) || '' : '');
  }, [filePath]);

  // Top and bottom trade places - both picks recorded, as from the menus. Each
  // offset follows its file, since offsets are kept per subtitle.
  const swap = useCallback(() => {
    const top = topSubtitle;
    chooseSubtitle('top', bottomSubtitle);
    chooseSubtitle('bottom', top);
  }, [topSubtitle, bottomSubtitle, chooseSubtitle]);

  useEffect(() => { if (topSubtitle) lastShownRef.current.top = topSubtitle; }, [topSubtitle]);
  useEffect(() => { if (bottomSubtitle) lastShownRef.current.bottom = bottomSubtitle; }, [bottomSubtitle]);

  /**
   * A slot off, or back on with the subtitle it last showed (else its default),
   * recorded like a menu pick. Returns what it shows now.
   */
  const toggleSlot = useCallback((slot: SubtitleSlot): FileNode | null => {
    const showing = slot === 'top' ? topSubtitle : bottomSubtitle;
    if (showing) {
      chooseSubtitle(slot, null, false);
      return null;
    }
    const last = lastShownRef.current[slot];
    const other = slot === 'top' ? bottomSubtitle : topSubtitle;
    const back = (last && availableSubtitles.find(s => s.path === last.path))
      || defaultSubtitle(availableSubtitles, fileName,
        languagePrefs.read(slot) || (slot === 'bottom' ? browserLanguage() : null), other);
    if (back) chooseSubtitle(slot, back, false);
    return back;
  }, [topSubtitle, bottomSubtitle, availableSubtitles, fileName, chooseSubtitle]);

  /**
   * A download landed: shown straight away only if nothing else is - a download
   * that changes nothing on screen reads as a failure, but a subtitle already
   * playing is a choice the user made and this must not overrule it.
   *
   * Recorded when it does land, because the default above would not choose it
   * again: a downloaded file is named for its source and language, not after the
   * video, so coming back tomorrow would show a different subtitle than the one
   * that was fetched for this film. Returns whether the slot was empty.
   */
  const fillBottom = useCallback((node: FileNode): boolean => {
    const wasEmpty = !bottomSubtitle;
    if (wasEmpty && filePath) bottomPickStore.write(filePath, node.path);
    setBottomSubtitle(prev => prev || node);
    return wasEmpty;
  }, [bottomSubtitle, filePath]);

  // Time no longer moves forward predictably after a seek, so the cue cursor has
  // to start over.
  const restartCueScan = useCallback(() => { cueIndexRef.current = 0; }, []);

  // Shifting the top subtitle is a subtraction and nothing else: the cues are held
  // in this app, so asking "what was showing 1.5s ago" is the whole feature.
  const updateTopCue = (t: number) => {
    const cues = topSubCuesRef.current;
    if (cues.length === 0) return;

    const { index, text } = cueAt(cues, t - topOffset, cueIndexRef.current);
    cueIndexRef.current = index;
    // Only a genuine change costs a render; React bails out when the value matches.
    setCurrentTopText(prev => (prev === text ? prev : text));
  };

  // A changed offset moves the cursor the same way a seek does, and the result has
  // to show now rather than at the next timeupdate a quarter-second away - the
  // buttons are being pressed to watch the text move.
  useEffect(() => {
    cueIndexRef.current = 0;
    const cues = topSubCuesRef.current;
    if (!videoRef.current || cues.length === 0) return;

    const { index, text } = cueAt(cues, videoRef.current.currentTime - topOffset, 0);
    cueIndexRef.current = index;
    setCurrentTopText(text);
  }, [topOffset]);

  return {
    availableSubtitles, filePathRef,
    topSubtitle, bottomSubtitle, chooseSubtitle, fillBottom, swap, toggleSlot,
    topOffset, bottomOffset, nudgeOffset,
    bottomSubtitleSrc, currentTopText, updateTopCue, restartCueScan,
  };
};
