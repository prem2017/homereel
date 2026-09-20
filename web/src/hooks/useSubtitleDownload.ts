import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchSubtitleLanguages, searchSubtitles, downloadSubtitle } from '../services/api';
import {
  FileNode, SubtitleLanguage, SubtitleCandidate, SubtitleDownloadResponse, SubsceneConfig,
} from '../types';

/**
 * Finding and downloading subtitles for the file currently open.
 *
 * It lives in a hook rather than in MediaPlayer because all of it is async work
 * with its own states, and MediaPlayer's render path is deliberately kept clear -
 * the component already avoids re-rendering during playback, and folding a
 * request lifecycle into it would be an easy way to undo that.
 *
 * Search and download are separate calls on purpose: providers meter downloads
 * (an anonymous OpenSubtitles key gets 5 a day, or 100 with "Under dev" ticked)
 * but not searches. So listing candidates is free, and quota is only spent on
 * one the user takes.
 */
export type SubtitleBusy = 'idle' | 'searching' | 'downloading';

/**
 * What one download produced. `extras` is what makes a season pack worth having:
 * the archive behind one id often holds every episode, so the ones matching other
 * videos in the same folder are saved too, and belong to *those* videos rather
 * than to the one playing.
 */
export interface SavedSubtitles {
  node: FileNode;
  extras: FileNode[];
}

// Derived rather than restated: a second copy of this shape is how the UI ends
// up quietly dropping a field the server sends.
type Quota = NonNullable<SubtitleDownloadResponse['quota']>;

// How long a transient message stays on screen. Long enough to read from a sofa.
const NOTICE_MS = 6000;

const refKey = (provider: string, ref: string) => `${provider}:${ref}`;

/**
 * Which file a reference already fetched this session left for *this* video.
 *
 * `available` is the caller's list of subtitles for the video playing, so this
 * asks two things at once: was this reference taken before, and did what it
 * wrote end up belonging here. Both halves are needed. One archive is often a
 * whole season, so the file that matches is routinely not the one the download
 * was named for - and a pack fetched while another film was open says nothing
 * about this one, which must then be a real download rather than a wrong answer
 * given instantly.
 */
export const reusableSubtitle = (
  saved: SavedSubtitles | null, available: FileNode[],
): FileNode | null => {
  if (!saved) return null;
  const wrote = new Set([saved.node, ...saved.extras].map((n) => n.path));
  return available.find((s) => wrote.has(s.path)) || null;
};

export const useSubtitleDownload = (filePath: string) => {
  const [languages, setLanguages] = useState<SubtitleLanguage[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<SubtitleBusy>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SubtitleCandidate[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  // The by-id box is the one control that names a site, so it needs to know
  // which address and whether that source is switched on at all. An older server
  // does not send this; the box then behaves as it always did.
  const [subscene, setSubscene] = useState<SubsceneConfig | null>(null);

  // Every reference fetched since this page loaded, and what it wrote. Typing an
  // id a second time is otherwise a second trip to the site for an archive
  // already unpacked onto the disk, saved again beside the first with nothing
  // but the counter to tell the two apart - ten times over for a season pack.
  //
  // Session-scoped, and it says so wherever it reaches the screen: the names on
  // disk record the source and the counter but never the id behind them, so a
  // reload cannot re-learn this and no file on disk can be asked. It is
  // deliberately *not* cleared when the video changes - one archive is often a
  // whole season, so an id taken during episode 1 is exactly the one worth
  // recognising while episode 5 is playing.
  const [taken, setTaken] = useState<Map<string, SavedSubtitles>>(new Map());

  const noticeTimerRef = useRef<number | null>(null);

  // Shown for a few seconds and then dropped: a source being down is worth
  // knowing about, but it is not an error state for the player to sit in.
  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  // Asked for once. Which languages exist and whether any source is usable both
  // come from .env, so the client cannot know them on its own.
  useEffect(() => {
    let cancelled = false;

    fetchSubtitleLanguages()
      .then((config) => {
        if (cancelled) return;
        setLanguages(config.languages);
        setReady(config.providers.length > 0);
        setSubscene(config.subscene || null);
      })
      .catch(() => {
        // An older server without these endpoints, or one that failed to start
        // the feature. Not worth an error on screen - the menus simply do not
        // offer online search, and local subtitle files keep working.
        if (!cancelled) setReady(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Which video is open now. A reply that lands after the user has moved on is
  // still saved - it belongs to the video it was asked for - but it changes
  // nothing on screen: episode 1's candidates offered during episode 5 were one
  // press from saving episode 1's subtitle under episode 5's name.
  const openRef = useRef(filePath);

  // A different film means different results.
  useEffect(() => {
    openRef.current = filePath;
    setCandidates([]);
    setError(null);
  }, [filePath]);

  // "French", not "fr", for anything the user reads. The list is the server's,
  // so a code outside it still says something rather than nothing.
  const nameOfLanguage = useCallback((code: string) => (
    languages.find((l) => l.code === code)?.name || code.toUpperCase()
  ), [languages]);

  const reportUnavailable = useCallback((unavailable: { name: string; reason: string }[]) => {
    if (unavailable.length === 0) return;
    flash(`${unavailable.map((u) => u.name).join(', ')} unavailable right now.`);
  }, [flash]);

  /**
   * Fetch one subtitle by the reference its provider uses and save it beside the
   * video. Split out from `take` because not every source produces candidates to
   * click: Subscene cannot be searched, so its reference is one the user read off
   * the site themselves.
   *
   * `language` is optional and only a fallback. One id can be a whole season in
   * one archive, in a language the site states on its own page, so what comes
   * back can be several files and need not be the language that was asked for -
   * hence `extras`, and hence saying out loud which language landed.
   */
  const takeRef = useCallback(async (
    provider: string, ref: string, language?: string,
  ): Promise<SavedSubtitles | null> => {
    setBusy('downloading');
    setError(null);
    try {
      const saved = await downloadSubtitle(filePath, language, provider, ref);
      if (saved.quota) setQuota(saved.quota);

      const extras = (saved.alsoSaved || []).map(
        (s): FileNode => ({ name: s.name, path: s.path, type: 'file' }),
      );
      // Both can be true at once - the pack this was written for is French and
      // was fetched with English still selected - so they are said together
      // rather than one of them being swallowed.
      const said = [];
      if (language && saved.language && saved.language !== language) {
        said.push(`That one is ${nameOfLanguage(saved.language)}, not ${nameOfLanguage(language)} - saved as ${nameOfLanguage(saved.language)}.`);
      }
      if (extras.length > 0) {
        said.push(`Also saved ${extras.length} for the other episodes in this folder.`);
      }
      // Saved either way; said only while its video is still the one open.
      if (said.length > 0 && openRef.current === filePath) flash(said.join(' '));

      const result: SavedSubtitles = {
        node: { name: saved.name, path: saved.path, type: 'file' }, extras,
      };
      setTaken((prev) => new Map(prev).set(refKey(provider, ref), result));
      return result;
    } catch (e) {
      if (openRef.current === filePath) setError(e instanceof Error ? e.message : 'Download failed.');
      return null;
    } finally {
      setBusy('idle');
    }
  }, [filePath, flash, nameOfLanguage]);

  /** Fetch one specific candidate and save it beside the video. */
  const take = useCallback((candidate: SubtitleCandidate): Promise<SavedSubtitles | null> =>
    takeRef(candidate.provider, candidate.ref, candidate.language), [takeRef]);

  /** What this reference already fetched in this session, if it did. */
  const takenBefore = useCallback((provider: string, ref: string): SavedSubtitles | null =>
    taken.get(refKey(provider, ref)) || null, [taken]);

  /** List what is on offer without spending any download quota. */
  const list = useCallback(async (language: string): Promise<SubtitleCandidate[]> => {
    setBusy('searching');
    setError(null);
    try {
      const result = await searchSubtitles(filePath, language);
      // Still handed back, so a Download pressed for that video carries on for
      // it - but not offered here, where a press would save it for this one.
      if (openRef.current !== filePath) return result.candidates;
      setCandidates(result.candidates);
      reportUnavailable(result.unavailable);
      if (result.candidates.length === 0) setError('No subtitles found for this file.');
      return result.candidates;
    } catch (e) {
      if (openRef.current !== filePath) return [];
      setError(e instanceof Error ? e.message : 'Search failed.');
      setCandidates([]);
      return [];
    } finally {
      setBusy('idle');
    }
  }, [filePath, reportUnavailable]);

  /**
   * Search and take the best result in one go.
   *
   * `skip` is how many subtitles are already saved for this video in this
   * language, so pressing Download again walks down the ranked list instead of
   * fetching the same file a second time and spending quota on it. The count
   * comes from the folder, so it survives a restart.
   *
   * The candidate list is still populated, so "none of these, let me look"
   * costs nothing extra afterwards.
   */
  const autoFetch = useCallback(async (language: string, skip = 0): Promise<SavedSubtitles | null> => {
    const found = await list(language);
    if (found.length === 0) return null;
    if (skip >= found.length) {
      if (openRef.current === filePath) setError(`No further subtitles on offer - you already have all ${found.length}.`);
      return null;
    }
    return take(found[skip]);
  }, [list, take, filePath]);

  return {
    languages, ready, subscene, busy, error, notice, candidates, quota,
    list, take, takeRef, autoFetch, takenBefore,
    // The same transient line the hook writes to itself. A download that is
    // skipped because the file is already here has to be said somewhere, and
    // this is where every other "here is what just happened" already goes.
    say: flash,
  };
};
