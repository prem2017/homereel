import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Type, ArrowLeft, ArrowRight, SkipForward, SkipBack, RotateCcw, RotateCw, Gauge,
  Loader2, AlertTriangle, ChevronLeft, ChevronRight, X, Keyboard
} from 'lucide-react';
import { formatTime } from '../utils/time';
import { normalizeKey } from '../utils/keys';
import { safePlay, fullscreenElement } from '../utils/media';
import { toVttBlob, parseSubtitleText, cueAt, VTTCue } from '../utils/subtitleParser';
import { createNumberStore, createStringStore, LocalStore } from '../utils/localNumbers';
import { readPref, writePref, PREF } from '../utils/prefs';
import { resumeStore, durationStore, isResumable } from '../utils/resume';
import { parseSubtitleFileName } from '../utils/subtitleNaming';
import { subtitlesFor } from '../utils/siblings';
import { reportToServer } from '../utils/remoteLog';
import { getStreamUrl, getSubtitleTextUrl } from '../services/api';
import { useSubtitleDownload, SavedSubtitles, reusableSubtitle } from '../hooks/useSubtitleDownload';
import { useSubsceneId, SubsceneIdState } from '../hooks/useSubsceneId';
import { FileNode, SubtitleCandidate } from '../types';

interface MediaPlayerProps {
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  siblings?: FileNode[];
  onEnded?: () => void;
  autoPlay?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
  /** What `onEnded` will move to, so it can be announced - and stopped - before
   *  it happens. Null when this is the last file in the folder. */
  nextName?: string | null;
  /** Every subtitle a download wrote, this video's own included - one archive is
   *  often a whole season. Required, not a notification: `siblings` is where the
   *  menus read from, so this is how a download reaches them. */
  onSubtitlesSaved: (nodes: FileNode[]) => void;
  /** A position has just been written to storage. The library reads those, so
   *  this is what lets "continue watching" show the film playing now rather than
   *  the one before it. Fires at the save cadence below, not per frame. */
  onProgress?: () => void;
}

type Status = 'idle' | 'loading' | 'buffering' | 'ready' | 'error';

const HIDE_CONTROLS_AFTER = 2500;
const GESTURE_WINDOW = 300;

// How far playback moves between saves of the resume position. Which positions
// are worth resuming is `isResumable`, shared with the library's list.
const RESUME_SAVE_EVERY = 5;

// Long enough to reach for the remote, short enough not to feel like a wait.
const UP_NEXT_SECONDS = 6;

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

const OFFSET_STEP = 0.5;
const OFFSET_FINE_STEP = 0.1;
const OFFSET_LIMIT = 60;

// How long to let the buttons settle before rebuilding the bottom track. Each
// rebuild remounts <track> and makes the browser reparse the file, so without
// this a run of taps blanks the subtitle repeatedly.
const OFFSET_COMMIT_MS = 200;

// Leading for a wrapped cue.
//
// A native cue is `display: inline`, so the browser paints its background once
// per *line*, not once per cue. That makes the leading visible as a hole between
// the two halves of a two-line subtitle, and the size of that hole is
// `line-height - contentArea`. The two are set by different fonts:
//
//   contentArea  the ascent+descent of the element's *primary* font (sans-serif
//                -> Arial here), about 1.14em whatever the text says;
//   line box     the metrics of whichever *fallback* font actually draws the
//                glyphs, about 1.29em for Devanagari.
//
// So `normal` is not neutral: it leaves ~0.15em of video showing between the
// lines of a Hindi subtitle and nothing at all between the lines of an English
// one, which is exactly why this was reported from a device and could not be
// seen on another. Matching the top overlay's `leading-relaxed` was worse still
// - the overlay is one <div> with one background box, so its leading sits
// *inside* the box, while here 1.625 widened the hole to 0.49em.
//
// 1.2 sits just above the primary font's content area, so consecutive lines'
// backgrounds meet and read as a single block, and it is still tall enough that
// stacked matras and deep conjuncts clear the line below. Checked in both
// scripts at 16px and 36px.
const CUE_LINE_HEIGHT = 1.2;

// How far each subtitle sits from its own edge of the picture, as a fraction of
// the picture's rendered height. A fraction rather than a constant because the
// same build runs in a phone-sized window and full screen on a 1080p TV, where a
// fixed gap is either invisible or a band.
//
// One number for both, so the two read as a matched pair rather than as two
// independently tuned offsets. Of the *picture*, which is not the same as the
// <video> element - see the letterbox note on pictureGeometry. That distinction
// is the whole reason this number was never the thing worth adjusting.
const PICTURE_EDGE_MARGIN = 0.04;

/**
 * How the by-id box looks and what it says, per state.
 *
 * A table because there are eight of them and the alternative is a ladder of
 * ternaries in the middle of the panel. `say` is the fallback - the server's own
 * words replace it wherever there are any, since only it knows the film's title
 * or which line of .env is wrong.
 *
 * No `gap-*` and no `focus-visible:` anywhere near this: Chromium 47.
 */
type SubsceneLook = { border: string; text: string; invalid: boolean; say: string };

const SUBSCENE_LOOK: Record<SubsceneIdState, SubsceneLook> = {
  empty: { border: 'border-gray-700 focus:border-blue-500', text: 'text-gray-400', invalid: false, say: 'The number at the end of the subtitle\'s page URL. The language comes with it.' },
  bad: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'Just the number from the end of the page URL, nothing else.' },
  short: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'Keep typing - an ID is about seven digits.' },
  checking: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'Checking that ID…' },
  good: { border: 'border-green-500', text: 'text-green-400', invalid: false, say: 'Found it. Press Get.' },
  missing: { border: 'border-red-500', text: 'text-red-400', invalid: true, say: 'No subtitle to download at that ID.' },
  unreachable: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'That address is not answering. Set a working one as SUBSCENE_URL in .env and restart.' },
  unchecked: { border: 'border-amber-400', text: 'text-amber-400', invalid: false, say: 'Could not check that ID - Get will try anyway.' },
  off: { border: 'border-gray-700', text: 'text-amber-400', invalid: false, say: 'Set SUBSCENE_URL in .env to a working Subscene address and restart.' },
};

// The states Get is offered in: verified, or unverified for a reason that is not
// about the id. A check that could not run is not a verdict and must not take a
// working button with it, and an address that was down a second ago is worth one
// press to retry - it fails with this same explanation if it is still down.
const CAN_FETCH: SubsceneIdState[] = ['good', 'unchecked', 'unreachable'];

// Not one of the box's states: the id is well-formed and the site would answer
// for it perfectly well. This is a fact about the session that outranks that
// answer, because the file the answer would produce is already on the disk. It
// needs no `invalid` - it is the one green that means "and you need not press".
const REUSE_LOOK = { border: 'border-green-500', text: 'text-green-400' };

// What the key handler further down actually implements, and the gestures the
// click handler implements. Kept in this file so the two cannot drift, and shown
// on demand because until now none of it appeared anywhere on screen: half the
// player was invisible unless you had read the source.
//
// Plain words rather than the media-key glyphs - an old TV font has no idea what
// those are and draws a box.
const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play or pause'],
  ['Left / Right', 'Back or forward 5 seconds'],
  ['Up / Down', 'Volume'],
  ['m', 'Mute'],
  ['f', 'Fullscreen (Esc or Back leaves it)'],
  ['n / p', 'Next or previous file in the folder'],
  ['g / h', 'Subtitle 0.1s earlier or later'],
  ['0 - 9', 'Jump to that tenth of the file'],
  ['?', 'This list'],
];

const GESTURES: Array<[string, string]> = [
  ['Click the middle', 'Play or pause'],
  ['Double-click a side', 'Skip 10 seconds that way'],
  ['Triple-click a side', 'Skip 15 seconds that way'],
];

const clampOffset = (value: number) =>
  Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, Math.round(value * 10) / 10));

const formatOffset = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}s`;

/**
 * Sync buttons for one subtitle slot.
 *
 * Sits directly under the Source menu it shifts, so with only one subtitle on
 * screen there is only one of these - the two-slot version of this control is
 * only paid for when both slots are in use.
 *
 * The readout doubles as the reset, which keeps a remote to three stops instead
 * of four. "Earlier"/"later" rather than -/+ because the sign is meaningless
 * until you have worked out which way it goes.
 */
const SyncRow: React.FC<{ offset: number; onNudge: (delta: number) => void }> = ({ offset, onNudge }) => {
  const button = 'text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40';

  return (
    <div className="flex items-center space-x-1 mt-1">
      <span className="text-xs text-gray-500 mr-1">Sync</span>
      <button type="button" className={button} title="Show subtitles earlier" onClick={() => onNudge(-OFFSET_STEP)}>
        ◀
      </button>
      <button
        type="button"
        className={`${button} font-mono w-16`}
        title={offset === 0 ? 'In sync' : 'Reset to 0.0s'}
        disabled={offset === 0}
        onClick={() => onNudge(0)}
      >
        {formatOffset(offset)}
      </button>
      <button type="button" className={button} title="Show subtitles later" onClick={() => onNudge(OFFSET_STEP)}>
        ▶
      </button>
    </div>
  );
};

// MEDIA_ERR_* translated into something readable from across a room. Codec trouble is
// by far the likeliest outcome on a TV, so name the type rather than saying "error".
const describeError = (video: HTMLVideoElement, mimeType: string | null): string => {
  const what = mimeType || 'this file';
  switch (video.error?.code) {
    case 1: return 'Playback was stopped before it started.';
    case 2: return 'Lost the connection while streaming. Check the network and try again.';
    case 3: return `Could not decode ${what}. The video uses a codec this browser does not support.`;
    case 4: return `This browser cannot play ${what}. Converting it to MP4 (H.264 video, AAC audio) will work.`;
    default: return 'Playback failed for an unknown reason.';
  }
};

const MediaPlayerView: React.FC<MediaPlayerProps> = ({
  filePath, fileName, mimeType, siblings = [], onEnded, autoPlay, onNext, onPrevious,
  nextName, onSubtitlesSaved, onProgress
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Written to directly during playback instead of via state - see handleTimeUpdate.
  const progressRef = useRef<HTMLInputElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const bufferedRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement>(null);
  // Everything that sits in the strip along the foot of the picture, which is
  // also where the browser draws native cues. All measured, so the bottom
  // subtitle can be lifted clear of whichever is showing - see the ::cue effect.
  const controlBarRef = useRef<HTMLDivElement>(null);
  const resumeNoticeRef = useRef<HTMLDivElement>(null);
  const upNextRef = useRef<HTMLDivElement>(null);
  // The top subtitle, which is not in that strip but needs the same measurement
  // from the other end. Mutable rather than a plain RefObject because it is set
  // from a ref callback - it only exists while a cue is on screen.
  const topOverlayRef = useRef<HTMLDivElement | null>(null);

  // Media State
  //
  // Volume, mute and speed are read back from the last visit. They are settings
  // about this room and this screen rather than about this film, and having to
  // set them again on every reload is what made the player feel like it had
  // forgotten who was using it.
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => readPref(PREF.volume, 1));
  const [isMuted, setIsMuted] = useState(() => readPref(PREF.muted, 0) === 1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(() => readPref(PREF.rate, 1));

  // Playback status
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formatWarning, setFormatWarning] = useState<string | null>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  // UI State
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<number | null>(null);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Seconds until the next file starts, or null when nothing is queued.
  const [upNextIn, setUpNextIn] = useState<number | null>(null);

  // Font Size States. Chosen for a screen and a viewing distance, so they are
  // the one setting it is most absurd to ask for twice.
  const [bottomFontSize, setBottomFontSize] = useState(() => readPref(PREF.bottomFont, 18));
  const [topFontSize, setTopFontSize] = useState(() => readPref(PREF.topFont, 18));

  useEffect(() => {
    writePref(PREF.volume, volume);
    writePref(PREF.muted, isMuted ? 1 : 0);
  }, [volume, isMuted]);

  useEffect(() => { writePref(PREF.rate, playbackRate); }, [playbackRate]);

  useEffect(() => {
    writePref(PREF.topFont, topFontSize);
    writePref(PREF.bottomFont, bottomFontSize);
  }, [topFontSize, bottomFontSize]);

  // Subtitle State
  //
  // Which files in this folder are subtitles for *this* video. Derived from the
  // folder listing every render and never copied into state: a download reaches
  // the menus by adding to that listing (see `applySubtitle`), and a second copy
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

  // Downloading is one control, not two. Which of the two overlays a subtitle ends
  // up on is a separate decision, made in the Source menus above - a file on disk
  // is not "the top one" until something puts it there.
  const subtitleFinder = useSubtitleDownload(filePath || '');
  const [searchLanguage, setSearchLanguage] = useState('');
  const [showCandidates, setShowCandidates] = useState(false);
  // Subscene has its own setting and takes no part in SUBTITLE_PROVIDERS, so the
  // ID box appears and disappears independently of the search menu above it.
  // Unknown (an older server that does not report it) counts as on: the box then
  // behaves as it did before there was anything to report.
  const subsceneOffered = subtitleFinder.subscene?.ready !== false;

  // Told while typing rather than after a failed fetch. The hook holds both
  // halves of that: the shape, which costs nothing, and whether the site
  // actually has a subtitle at that id, which costs one free lookup.
  const subsceneBox = useSubsceneId(subsceneOffered);

  // What this app has already fetched for this video in the chosen language. The
  // filenames are the record - there is no list kept anywhere - so this is still
  // right after a restart, and a subtitle the user deleted stops counting.
  // (availableSubtitles is already narrowed to this video, so language is the
  // only thing left to ask.)
  const alreadyDownloaded = useMemo(() => availableSubtitles
    .map(node => ({ node, parsed: parseSubtitleFileName(node.name) }))
    .filter(({ parsed }) => parsed !== null && parsed.language === searchLanguage)
    .sort((a, b) => a.parsed!.counter - b.parsed!.counter),
    [availableSubtitles, searchLanguage]);

  // The video on screen now, for replies that land after the one they were asked
  // for - `filePath` inside a callback is the video when the request was made.
  const filePathRef = useRef(filePath);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  // A downloaded subtitle is saved next to the video, so it belongs in the same
  // list as the files that were already there. Splicing it into the folder
  // listing beats refetching the file tree: the tree scan is synchronous and
  // whole-library, and this runs on a TV that is mid-playback.
  //
  // All of it goes up, this video's own along with the rest. A season pack also
  // wrote subtitles for the other episodes here, so episode 6 would not see its
  // own until a reload - and keeping this one back would leave two lists in play,
  // the private one being discarded the moment the folder listing changed, which
  // those very extras cause.
  const applySubtitle = useCallback(({ node, extras }: SavedSubtitles) => {
    onSubtitlesSaved([node, ...extras]);
    // Finished after the user moved to another video. It is saved and listed for
    // the video it was fetched for; filling an empty slot now would put that
    // video's dialogue over this one, with nothing in the menus to say so.
    if (filePath !== filePathRef.current) return;
    // Shown straight away only if nothing else is - a download that changes
    // nothing on screen reads as a failure, but a subtitle already playing is a
    // choice the user made and this must not overrule it.
    //
    // Recorded when it does land, because the default below would not choose it
    // again: a downloaded file is named for its source and language, not after
    // the video, so coming back tomorrow would show a different subtitle than
    // the one that was fetched for this film.
    if (!bottomSubtitle && filePath) bottomPickStore.write(filePath, node.path);
    setBottomSubtitle(prev => prev || node);
  }, [onSubtitlesSaved, bottomSubtitle, filePath]);

  const handleLanguagePick = useCallback((language: string) => {
    setSearchLanguage(language);
    setShowCandidates(false);
  }, []);

  // Take the best match that is not already on disk. Pressing Download again
  // therefore walks down the ranked list rather than paying for the same file
  // twice - which is what "that one is no good, try another" has to mean when
  // every download is metered.
  const handleDownload = useCallback(async () => {
    if (!searchLanguage) return;
    const saved = await subtitleFinder.autoFetch(searchLanguage, alreadyDownloaded.length);
    if (saved) applySubtitle(saved);
  }, [subtitleFinder, applySubtitle, searchLanguage, alreadyDownloaded.length]);

  const handleShowAll = useCallback(async () => {
    setShowCandidates(true);
    await subtitleFinder.list(searchLanguage);
  }, [subtitleFinder, searchLanguage]);

  const handleTakeCandidate = useCallback(async (candidate: SubtitleCandidate) => {
    const saved = await subtitleFinder.take(candidate);
    if (saved) {
      applySubtitle(saved);
      setShowCandidates(false);
    }
  }, [subtitleFinder, applySubtitle]);

  // The id in the box, if this session already fetched it *and* what it wrote is
  // a subtitle for the video playing. Both halves matter: a season pack taken
  // during episode 1 has a file for this episode too, and it is that file - not
  // the one the download was named for - that "already downloaded" means here.
  //
  // Known locally and immediately, so it is the answer even while the site is
  // still being asked about the same id.
  const subsceneReuse = useMemo(
    () => reusableSubtitle(subtitleFinder.takenBefore('subscene', subsceneBox.value.trim()), availableSubtitles),
    [subtitleFinder.takenBefore, subsceneBox.value, availableSubtitles],
  );

  // What the box looks like and what the line under it says. The reuse case is
  // put first deliberately: it is a stronger statement than any verdict the site
  // can give about the same id, and it is true while that verdict is pending.
  const subsceneLook = subsceneReuse ? REUSE_LOOK : SUBSCENE_LOOK[subsceneBox.state];
  const subsceneSaid = subsceneReuse
    ? `Already downloaded this session - ${subsceneReuse.name}. Use it selects that file, nothing is fetched again.`
    : (subsceneBox.state === 'off' ? subtitleFinder.subscene?.reason : subsceneBox.detail)
      || SUBSCENE_LOOK[subsceneBox.state].say;

  // Subscene has no searchable API, so its half of the feature is the user
  // pasting the id from a page they found themselves.
  const handleSubsceneFetch = useCallback(async () => {
    const id = subsceneBox.value.trim();
    if (!id) return;

    // Already fetched, already on disk: select it and say so instead of fetching
    // the same archive again to write a copy of a file that is already here.
    // What reaches the screen follows the same rule a real download follows -
    // fill an empty slot, never displace a choice the user has made - so the two
    // paths cannot disagree about what a press does to what is playing.
    if (subsceneReuse) {
      const wasEmpty = !bottomSubtitle;
      if (wasEmpty && filePath) bottomPickStore.write(filePath, subsceneReuse.path);
      setBottomSubtitle(prev => prev || subsceneReuse);
      subtitleFinder.say(wasEmpty
        ? `Already downloaded this session - showing ${subsceneReuse.name}.`
        : `Already downloaded this session - ${subsceneReuse.name} is in the Source menus.`);
      subsceneBox.setValue('');
      return;
    }

    // The language menu is passed as a fallback, not as an instruction: the id
    // names one specific file on the site, and the site states what language it
    // is. If the two disagree, the file wins and the panel says so.
    const saved = await subtitleFinder.takeRef('subscene', id, searchLanguage || undefined);
    if (saved) {
      applySubtitle(saved);
      subsceneBox.setValue('');
    }
  }, [subtitleFinder, applySubtitle, subsceneBox, searchLanguage, subsceneReuse, bottomSubtitle, filePath]);

  // Click Gesture States
  const clickTimeoutRef = useRef<number | null>(null);
  const clickCountRef = useRef(0);

  const isScrubbingRef = useRef(false);
  const lastSavedRef = useRef(0);

  // Mirrors of state that timers and DOM listeners read. Those callbacks are created
  // once and would otherwise keep reading whatever the value was at that moment.
  const isPlayingRef = useRef(false);
  const showSubSettingsRef = useRef(false);
  const showHelpRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { showSubSettingsRef.current = showSubSettings; }, [showSubSettings]);
  useEffect(() => { showHelpRef.current = showHelp; }, [showHelp]);

  // Clicking past the subtitle panel closes it, the same way the search results
  // in the header work. It covers a corner of the film and has no close button
  // of its own, so without this the only way out was to find the small button
  // that opened it. Bounded by the wrapper rather than the panel, so the press
  // that toggles the button is not read as a press outside.
  const subPanelRef = useRef<HTMLDivElement>(null);
  // The panel itself rather than the wrapper above: the wrapper is `relative`
  // and the panel inside it is absolute, so the wrapper measures the width of
  // the toggle button and nothing else.
  const subPanelBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSubSettings) return;
    const onClickAway = (e: MouseEvent) => {
      if (!subPanelRef.current?.contains(e.target as Node)) setShowSubSettings(false);
    };
    document.addEventListener('click', onClickAway);
    return () => document.removeEventListener('click', onClickAway);
  }, [showSubSettings]);

  // 1a. Both slots empty when the video changes - and only then. A subtitle that
  // lands mid-playback grows the list without touching what is on screen, which
  // is the difference between "a new file is available" and "you are watching a
  // different film".
  useEffect(() => {
    setTopSubtitle(null);
    setBottomSubtitle(null);
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

  // Only a deliberate choice is recorded, so "no record" keeps meaning "work it
  // out" - and a default that improves later still applies.
  const rememberPick = (store: LocalStore<string>, sub: FileNode | null) => {
    if (filePath) store.write(filePath, sub ? sub.path : '');
  };

  // 1b. Fill the slots once there is something to put in them: last time's
  // choice where there is one, otherwise a default in the bottom slot only.
  // Everything in the list is this video's, so the first is a fair default -
  // preferring one named exactly after the file, which is a subtitle the user
  // placed themselves and so an explicit choice.
  //
  // Every branch fills rather than assigns: this runs again when the list grows,
  // and by then the user - or the download that grew it - has already chosen. On
  // a change of video the reset above is queued first, so the updater sees null
  // and this picks the new file's own.
  useEffect(() => {
    const rememberedTop = rememberedPick(topPickStore);
    if (rememberedTop) setTopSubtitle(prev => prev || rememberedTop);

    const baseName = fileName ? fileName.substring(0, fileName.lastIndexOf('.')) : '';
    const fallback = availableSubtitles.find(s => s.name.startsWith(baseName))
      || availableSubtitles[0] || null;
    const rememberedBottom = rememberedPick(bottomPickStore);
    setBottomSubtitle(prev => prev || (rememberedBottom !== undefined ? rememberedBottom : fallback));
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

  // Where the film is actually drawn, which is not where the <video> element is.
  //
  // The element is `object-contain`, so a film whose shape does not match the
  // window is drawn as a smaller rectangle centred in it, with black above and
  // below. Both subtitles are positioned against the element - Blink lays native
  // cues out that way, and the top overlay is absolutely positioned in a box that
  // matches it - so both were being placed against the edge of the *black*.
  // Measured: a 2.40:1 film in a 366x688 portrait element renders 366x153,
  // leaving a 268px bar, which put the bottom cue 240px below the picture and the
  // top overlay some 228px above it.
  //
  // One helper because it is one measurement; two copies is how the two subtitles
  // end up disagreeing about where the picture is. `known` is false until
  // loadedmetadata, since videoWidth is 0 until then, and for an <audio> element
  // forever - callers fall back to the element's own box, which is the old
  // behaviour.
  const pictureGeometry = useCallback(() => {
    const el = videoRef.current;
    if (!el) return null;

    const box = el.getBoundingClientRect();
    const width = (el as HTMLVideoElement).videoWidth;
    const ratio = width ? (el as HTMLVideoElement).videoHeight / width : 0;
    const height = ratio ? Math.min(box.height, box.width * ratio) : box.height;

    return { box, height, letterbox: (box.height - height) / 2, known: !!ratio };
  }, []);

  // The top overlay is this app's own element, so it is placed by writing `top`
  // rather than by transforming a shadow pseudo-element - but it is the same
  // measurement and was the same bug, upside down.
  //
  // Written through a ref rather than into state, for the reason the rest of this
  // file writes to the DOM directly: MediaPlayer is memoized and this runs on
  // every resize, so a style prop would put it back on the render treadmill.
  //
  // It is a ref *callback* because the overlay is only mounted while a cue is on
  // screen. That is the one moment its position must be set, and doing it here
  // keeps the cue text out of writeCueStyle's dependencies - which would rewrite
  // the ::cue rule, and so invalidate the CSSOM, once per line of dialogue.
  //
  // Geometry that is not known yet leaves `top` alone, so the class's own top-10
  // stands as the fallback.
  const placeTopSubtitle = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const picture = pictureGeometry();
    if (!picture || !picture.known) return;
    node.style.top = `${Math.round(picture.letterbox + picture.height * PICTURE_EDGE_MARGIN)}px`;
  }, [pictureGeometry]);

  const topSubtitleRef = useCallback((node: HTMLDivElement | null) => {
    topOverlayRef.current = node;
    placeTopSubtitle(node);
  }, [placeTopSubtitle]);

  // ::cue cannot be set from an inline style, so it needs a real stylesheet. Mutating
  // the element's text from an effect - rather than re-emitting <style> on render -
  // keeps a font-size change from invalidating the CSSOM on every frame of playback.
  // Deliberately not a CSS custom property: var() needs Chrome 49 and the TVs this
  // targets are Chromium 47.
  // filePath is in the deps because the element itself only exists once there is
  // something to play - before that the early return renders "Select media" and
  // there is nothing to write to. Keyed on the size alone, the rule was written
  // at mount into a null ref and then never again, so the bottom subtitle used
  // the browser's default size until the slider was touched. Invisible while the
  // size was 18px every time; obvious the moment the size is remembered.
  //
  // The second rule is why the bottom subtitle read as broken. The browser draws
  // native cues at the foot of the video, which is exactly where this player
  // stacks everything else, so the subtitle sat *behind* whatever was there -
  // present in the DOM, showing, timed correctly, and unreadable.
  //
  // ::cue cannot move a cue - it styles the box, not its position - so the
  // container is the only handle Blink offers.
  //
  // The lift clears *every* overlay in that strip, not just the control bar.
  // Clearing the bar alone was the first attempt and it moved the subtitle
  // straight underneath the resume notice, which is centred at bottom-24 - the
  // exact band a lifted cue lands in. That notice is on screen for the opening
  // seconds of a resumed film, which is precisely when someone checks whether
  // subtitles work, so the fault looked identical to the one it replaced. Hence
  // the measurement is per-overlay and against the foot of the picture: a
  // constant would have to be re-derived every time one of them changes height,
  // and an overlay added later would silently reintroduce this.
  //
  // The horizontal shift is the same problem lying down. The settings panel
  // covers the right-hand side, and a centred cue runs under it at exactly the
  // moment the user is certainly reading subtitles - they opened the panel to
  // adjust them.
  //
  // An engine that does not know the selector drops this rule alone and behaves
  // exactly as before; ::cue above is a separate rule and is unaffected.
  const writeCueStyle = useCallback(() => {
    if (!styleRef.current) return;

    const picture = pictureGeometry();
    const video = picture ? picture.box : null;
    const foot = video ? video.bottom : 0;
    // A null ref is an overlay that is not rendered at all; `visible` covers the
    // one that is rendered but faded out, since it keeps its layout box.
    const clearance = (node: HTMLElement | null, visible: boolean) =>
      node && visible ? Math.max(0, foot - node.getBoundingClientRect().top) : 0;

    const pictureHeight = picture ? picture.height : 0;
    const letterbox = picture ? picture.letterbox : 0;

    const lift = Math.round(
      Math.max(
        clearance(controlBarRef.current, showControls),
        clearance(resumeNoticeRef.current, showControls),
        clearance(upNextRef.current, true),
        // Not an overlay but the same kind of obstacle: everything below this is
        // not the film. Taking the greater of the two rather than adding them
        // keeps a full-bleed picture behaving exactly as it did.
        letterbox,
      )
      // Always, not only when something is in the way: Blink sits a cue flush on
      // the foot of the picture, which reads as falling off the bottom edge.
      + pictureHeight * PICTURE_EDGE_MARGIN,
    );
    const shift = subPanelBodyRef.current
      ? subPanelBodyRef.current.getBoundingClientRect().width / 2
      : 0;

    // Absolute, and stated twice. A line box is the taller of the cue's own
    // leading and the *strut* of the block it sits in, and that block's font is
    // sized by the browser from the video's height (~27px here), not from the
    // size chosen for subtitles. So a small subtitle keeps the strut's leading
    // and the hole comes back below about 24px - which is the size the setting
    // starts at. Setting it on the display block too pins the strut to the same
    // value; in px so it does not multiply that block's font size instead.
    const leading = Math.round(bottomFontSize * CUE_LINE_HEIGHT * 100) / 100;

    styleRef.current.textContent =
      `video::cue { font-size: ${bottomFontSize}px; line-height: ${leading}px; background-color: rgba(0,0,0,0.75); color: white; border-radius: 4px; }`
      + `\nvideo::-webkit-media-text-track-display { line-height: ${leading}px; }`
      + `\nvideo::-webkit-media-text-track-container { transform: translate(-${shift}px, -${lift}px); transition: transform 300ms; }`;
    // Everything after the first two is a *recompute trigger* rather than a value
    // this reads: each one changes the size or presence of something measured
    // above, so the numbers are wrong until it runs again.
  }, [bottomFontSize, showControls, filePath, resumedFrom, upNextIn, showSubSettings, isFullscreen]);

  useEffect(() => { writeCueStyle(); }, [writeCueStyle]);

  // ...and again whenever the picture itself changes size, which no amount of
  // state can announce. This is what was wrong with the margin: every number
  // above is measured, so all of them go stale the moment the video is laid out
  // differently, and the lift stayed at the value computed for the old size.
  //
  // Fullscreen is the case that bit, and `isFullscreen` above does not cover it:
  // toggleFullscreen sets the state synchronously, so the effect runs before the
  // browser has resized anything, and the fullscreenchange event that follows
  // sets the same value again - so React bails out and it is never recomputed
  // against the size that actually shipped. Measuring on the event, not on the
  // state, is the fix. Rotating a phone is the same failure with no state
  // involved at all.
  //
  // Plain listeners rather than a ResizeObserver: that is Chrome 64 and the
  // reference TV is Chromium 47, and these cover every case that moves the foot
  // of the picture.
  //
  // `loadedmetadata` is in here for the letterbox bar rather than the window:
  // videoWidth is 0 until it fires, so until then the film's shape is unknown
  // and the bar reads as zero. Without it the first cue of every file is placed
  // as though the picture filled the element.
  useEffect(() => {
    // Both subtitles, since both are placed off the same measurement. The top one
    // is only repositioned here and on mount: nothing else about it moves, so it
    // has no business in writeCueStyle's deps.
    const recompute = () => { writeCueStyle(); placeTopSubtitle(topOverlayRef.current); };
    const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    const media = videoRef.current;

    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    fsEvents.forEach(e => document.addEventListener(e, recompute));
    if (media) media.addEventListener('loadedmetadata', recompute);

    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
      fsEvents.forEach(e => document.removeEventListener(e, recompute));
      if (media) media.removeEventListener('loadedmetadata', recompute);
    };
  }, [writeCueStyle, placeTopSubtitle]);

  // Warn before streaming gigabytes of something the browser will refuse. canPlayType
  // is advisory - '' is a firm no, anything else is a maybe - so this warns and lets
  // playback go ahead rather than blocking it.
  useEffect(() => {
    if (!filePath || !mimeType) {
      setFormatWarning(null);
      return;
    }
    const probe = document.createElement(mimeType.startsWith('audio') ? 'audio' : 'video');
    setFormatWarning(probe.canPlayType(mimeType) === '' ? mimeType : null);
  }, [filePath, mimeType]);

  // Initialize Video
  useEffect(() => {
    if (videoRef.current && filePath) {
      setStatus('loading');
      setErrorMessage(null);
      setResumedFrom(null);
      // Whatever was queued belongs to the file that just finished.
      setUpNextIn(null);
      cueIndexRef.current = 0;
      lastSavedRef.current = 0;
      videoRef.current.load();
      videoRef.current.playbackRate = playbackRate; // Maintain rate
      if (autoPlay) {
        safePlay(videoRef.current);
      }
    }
  }, [filePath, autoPlay]);

  // Apply Rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Volume lives on the element, and the element is replaced with every file, so
  // a level restored into React state has to be pushed back onto it or the first
  // file of the session plays at full blast. Idempotent: the handlers below set
  // the element first and this only ever agrees with them.
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = volume;
    videoRef.current.muted = isMuted;
  }, [filePath, volume, isMuted]);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        safePlay(videoRef.current);
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, []);

  const skip = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
      // Time no longer moves forward predictably, so the cue cursor has to start over.
      cueIndexRef.current = 0;
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      cueIndexRef.current = 0;
    }
  }, []);

  const changeVolume = useCallback((delta: number) => {
    if (!videoRef.current) return;
    const next = Math.min(1, Math.max(0, videoRef.current.volume + delta));
    videoRef.current.volume = next;
    videoRef.current.muted = next === 0;
    setVolume(next);
    setIsMuted(next === 0);
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const newMuted = !videoRef.current.muted;
      videoRef.current.muted = newMuted;
      setIsMuted(newMuted);
      if (!newMuted && videoRef.current.volume === 0) {
        setVolume(0.5);
        videoRef.current.volume = 0.5;
      }
    }
  }, []);

  const cyclePlaybackRate = () => {
    const rates = [0.5, 0.9, 1, 1.1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
  };

  const toggleFullscreen = useCallback(() => {
    if (!fullscreenElement()) {
      const elem = containerRef.current as any;
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) { /* Safari */
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) { /* IE11 */
        elem.msRequestFullscreen();
      } else if (elem.mozRequestFullScreen) { /* Firefox */
        elem.mozRequestFullScreen();
      } else if (videoRef.current && (videoRef.current as any).webkitEnterFullscreen) {
        // Fallback for iOS video element
        (videoRef.current as any).webkitEnterFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
      setIsFullscreen(false);
    }
  }, []);

  // Leaving fullscreen via Esc or the TV's own back button never went through
  // toggleFullscreen, so the icon used to get stuck showing "exit".
  useEffect(() => {
    const sync = () => setIsFullscreen(!!fullscreenElement());
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(evt => document.addEventListener(evt, sync));
    return () => events.forEach(evt => document.removeEventListener(evt, sync));
  }, []);

  const showFeedbackIcon = (type: string) => {
    setFeedback(type);
    setTimeout(() => setFeedback(null), 800);
  };
  const [feedback, setFeedback] = useState<string | null>(null);

  // Any sign of life re-reveals the controls and restarts the countdown. Driven by
  // keys and clicks as well as the mouse, because a TV has no pointer at all and the
  // bar would otherwise sit over the film forever.
  const bumpActivity = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlayingRef.current && !showSubSettingsRef.current && !showHelpRef.current) {
        setShowControls(false);
      }
    }, HIDE_CONTROLS_AFTER);
  }, []);

  useEffect(() => {
    if (!filePath) return;
    const events: Array<keyof WindowEventMap> = ['keydown', 'click', 'mousemove', 'touchstart'];
    events.forEach(evt => window.addEventListener(evt, bumpActivity));
    bumpActivity();
    return () => {
      events.forEach(evt => window.removeEventListener(evt, bumpActivity));
      if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    };
  }, [filePath, bumpActivity]);

  // Keyboard + TV remote
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!filePath) return;

      const key = normalizeKey(e);
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;

      // A focused text field or slider owns every key. A focused button owns only the
      // keys that activate it - arrows should still seek while one has focus.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
      if (tag === 'BUTTON' && (key === ' ' || key === 'Enter')) return;

      switch (key) {
        case ' ':
        case 'MediaPlayPause': e.preventDefault(); togglePlay(); break;
        case 'MediaPlay': if (videoRef.current) safePlay(videoRef.current); setIsPlaying(true); break;
        case 'MediaPause': videoRef.current?.pause(); setIsPlaying(false); break;
        case 'MediaStop': videoRef.current?.pause(); setIsPlaying(false); seekTo(0); break;

        case 'ArrowLeft': e.preventDefault(); skip(-5); break;
        case 'ArrowRight': e.preventDefault(); skip(5); break;
        case 'MediaRewind': skip(-10); showFeedbackIcon('back-10'); break;
        case 'MediaFastForward': skip(10); showFeedbackIcon('forward-10'); break;

        case 'ArrowUp': e.preventDefault(); changeVolume(0.05); break;
        case 'ArrowDown': e.preventDefault(); changeVolume(-0.05); break;

        case 'm': toggleMute(); break;
        case 'f': toggleFullscreen(); break;
        case 'n': onNext?.(); break;
        case 'p': onPrevious?.(); break;

        // Subtitle sync, in finer steps than the buttons - a keyboard can afford
        // them. Whichever slot is in use, bottom first: it is the one a single
        // subtitle lands in, so with one on screen this is never ambiguous.
        case 'g': nudgeOffset(bottomSubtitle ? 'bottom' : 'top', -OFFSET_FINE_STEP); break;
        case 'h': nudgeOffset(bottomSubtitle ? 'bottom' : 'top', OFFSET_FINE_STEP); break;

        // Shift+/ has no keyCode of its own on Chromium 47, so this is the
        // modern-browser half of the shortcut. The button in the control bar is
        // the half that works on a remote, and both are needed.
        case '?': setShowHelp(open => !open); break;

        case 'Escape':
        case 'Back':
          // Innermost thing first: the panel the key most likely means.
          if (showHelpRef.current) setShowHelp(false);
          else if (showSubSettingsRef.current) setShowSubSettings(false);
          else if (fullscreenElement()) toggleFullscreen();
          break;

        default:
          // 0-9 jump to that tenth of the file.
          if (key.length === 1 && key >= '0' && key <= '9' && videoRef.current?.duration) {
            seekTo((parseInt(key, 10) / 10) * videoRef.current.duration);
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filePath, togglePlay, skip, seekTo, changeVolume, toggleMute, toggleFullscreen, onNext, onPrevious, nudgeOffset, bottomSubtitle]);

  const paintBuffered = () => {
    const video = videoRef.current;
    const bar = bufferedRef.current;
    if (!video || !bar || !video.duration) return;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) > end) {
        end = video.buffered.end(i);
      }
    }
    bar.style.width = `${Math.min(100, (end / video.duration) * 100)}%`;
  };

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

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;

    // Straight to the DOM rather than through setState. This fires ~4x a second for
    // the whole length of a film, and routing it through React re-rendered the entire
    // player each time - control bar, both subtitle menus and all their options.
    if (!isScrubbingRef.current) {
      if (progressRef.current) progressRef.current.value = String(t);
      if (timeLabelRef.current) timeLabelRef.current.textContent = formatTime(t);
      paintBuffered();
    }

    updateTopCue(t);

    // Distance, not elapsed time: a seek backwards used to leave the saved
    // position ahead of where playback actually was, and it stayed there until
    // the film caught up - so quitting after a rewind came back to the wrong
    // place, and the library's bar sat still for as long as it took.
    if (filePath && Math.abs(t - lastSavedRef.current) >= RESUME_SAVE_EVERY) {
      lastSavedRef.current = t;
      resumeStore.write(filePath, t);
      onProgress?.();
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);

    if (!filePath) return;
    // The length is the other half of "how far through this is": the library
    // draws its bars from the pair, and the player is the only thing ever in a
    // position to learn it.
    if (isFinite(video.duration) && video.duration > 0) {
      durationStore.write(filePath, video.duration);
    }

    const saved = resumeStore.read(filePath);
    if (saved && isResumable(saved, video.duration)) {
      video.currentTime = saved;
      cueIndexRef.current = 0;
      setResumedFrom(saved);
    }
  };

  const handleDurationChange = () => {
    if (videoRef.current) setDuration(videoRef.current.duration);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    // Finished means there is nothing to come back to - and the library has to
    // hear about the removal as well as the writes, or the row stays.
    if (filePath) {
      resumeStore.write(filePath, null);
      onProgress?.();
    }

    // Said out loud before it happens, when there is somewhere to go. The jump
    // to the next episode was instant and silent, which is fine when it is what
    // you wanted and impossible to stop when it is not.
    if (nextName && onEnded) {
      setUpNextIn(UP_NEXT_SECONDS);
      return;
    }
    onEnded && onEnded();
  };

  const playNextNow = () => {
    setUpNextIn(null);
    if (onEnded) onEnded();
  };

  // One timer re-armed each second, so cancelling is only clearing the number -
  // and the number is what the toast counts down.
  useEffect(() => {
    if (upNextIn === null) return;
    if (upNextIn <= 0) {
      setUpNextIn(null);
      if (onEnded) onEnded();
      return;
    }
    const timer = window.setTimeout(() => setUpNextIn(upNextIn - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [upNextIn, onEnded]);

  const startOver = () => {
    seekTo(0);
    setResumedFrom(null);
    if (filePath) {
      resumeStore.write(filePath, null);
      onProgress?.();
    }
  };

  // Scrubbing: show the target time while dragging but only seek once, on release.
  // Assigning currentTime on every step of the slider fired a seek per pixel, and
  // each one aborts the in-flight range request to open a new one.
  const handleScrubStart = () => { isScrubbingRef.current = true; };

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (timeLabelRef.current) timeLabelRef.current.textContent = formatTime(t);
    // Keyboard users get no mousedown, so there is no drag to wait for.
    if (!isScrubbingRef.current) seekTo(t);
  };

  const handleScrubCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    seekTo(parseFloat(e.currentTarget.value));
  };

  // Act on the first click instead of waiting to learn whether more are coming, then
  // correct course if they are. The old version delayed every side-of-screen
  // play/pause by the full gesture window.
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // With the subtitle panel open, a click on the film is a dismissal and
    // nothing else. Pausing as well would make closing it cost a second press.
    if (showSubSettingsRef.current) {
      setShowSubSettings(false);
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const isRight = x > rect.width * 0.66;
    const isLeft = x < rect.width * 0.33;

    if (!isLeft && !isRight) {
      togglePlay();
      return;
    }

    const direction = isRight ? 1 : -1;
    clickCountRef.current += 1;

    if (clickCountRef.current === 1) {
      togglePlay();
    } else if (clickCountRef.current === 2) {
      togglePlay();                        // undo the speculative toggle
      skip(direction * 10);
      showFeedbackIcon(direction > 0 ? 'forward-10' : 'back-10');
    } else if (clickCountRef.current === 3) {
      skip(direction * 5);                 // promote the 10s skip to 15s
      showFeedbackIcon(direction > 0 ? 'forward-15' : 'back-15');
    }

    if (clickTimeoutRef.current) window.clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = window.setTimeout(() => { clickCountRef.current = 0; }, GESTURE_WINDOW);
  };

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full bg-black text-gray-500 rounded-lg shadow-inner">
        <div className="text-center">
          <Play size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-xl">Select media to play</p>
        </div>
      </div>
    );
  }

  const isAudio = mimeType?.startsWith('audio');
  const isBusy = status === 'loading' || status === 'buffering';

  const mediaEvents = {
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: handleLoadedMetadata,
    onDurationChange: handleDurationChange,
    onEnded: handleEnded,
    onPlay: () => { setIsPlaying(true); setStatus('ready'); },
    onPause: () => setIsPlaying(false),
    onLoadStart: () => setStatus('loading'),
    // canPlayType() reports only what the browser will admit to. Samsung's TV
    // browser answers '' for video/x-matroska and then plays it perfectly well,
    // so the warning is a guess - and a decoded frame disproves it. Retract it
    // rather than leaving a scary banner over a working film.
    onLoadedData: () => setFormatWarning(null),
    onWaiting: () => setStatus('buffering'),
    onCanPlay: () => setStatus(prev => (prev === 'error' ? prev : 'ready')),
    onPlaying: () => setStatus('ready'),
    onProgress: paintBuffered,
    onError: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      const media = e.currentTarget as HTMLVideoElement;
      const message = describeError(media, mimeType);
      setStatus('error');
      setErrorMessage(message);
      // The TV browser has no devtools, so the server log is the only place this can
      // be read back from.
      reportToServer(`TV Video Error: code ${media.error?.code} on file: ${filePath} (${mimeType}) - ${message}`);
      console.error("Video Error:", message);
    },
  };

  return (
    <div
      ref={containerRef}
      className={`relative bg-black group w-full h-full flex flex-col justify-center overflow-hidden rounded-lg shadow-2xl ${isFullscreen ? 'h-screen w-screen rounded-none' : ''}`}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Rule text is written from an effect, so this element is never re-rendered. */}
      <style ref={styleRef} />

      {!isAudio && (
        <div
          // The pointer is hidden along with the controls. It sat over the
          // picture for the length of a film otherwise, and any movement brings
          // both back at once.
          className={`absolute inset-0 z-10 ${showControls ? 'cursor-pointer' : 'cursor-none'}`}
          onClick={handleContainerClick}
        ></div>
      )}

      {/* Video / Audio */}
      {isAudio ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-0">
          <div className="animate-pulse"><Volume2 size={96} className="text-blue-500 opacity-50" /></div>
          <audio ref={videoRef as React.RefObject<HTMLAudioElement>} src={getStreamUrl(filePath)} {...mediaEvents} />
        </div>
      ) : (
        <video
          ref={videoRef}
          src={getStreamUrl(filePath)}
          className="w-full h-full object-contain bg-black"
          playsInline
          preload="metadata"
          {...mediaEvents}
        >
          {/* Native Track Element - Now supports SRT via Blob conversions.
              Only while the file it was built for is open, so a switch removes it
              in the same commit that changes src - and first, since React removes
              a node's children before updating the node. Removed afterwards by the
              reset effects, it left Blink painting the cue over the next video. */}
          {bottomSubtitleSrc && bottomSubtitleSrc.filePath === filePath && (
            <track
              key={bottomSubtitleSrc.url} // Force re-render on change
              label="Bottom"
              kind="subtitles"
              srcLang="en"
              src={bottomSubtitleSrc.url}
              default
            />
          )}
        </video>
      )}

      {/* Top Subtitle Custom Overlay.
          top-10 is the fallback for the frame before the film's shape is known;
          placeTopSubtitle overwrites it with the top of the picture, which in a
          letterboxed window is a long way down from the top of the element. */}
      {currentTopText && (
        <div ref={topSubtitleRef} className="absolute top-10 left-0 right-0 z-20 text-center pointer-events-none">
          <span
            className="bg-black/75 text-white px-3 py-1.5 rounded leading-relaxed inline-block max-w-[80%] whitespace-pre-wrap"
            style={{ fontSize: `${topFontSize}px` }}
          >
            {currentTopText}
          </span>
        </div>
      )}

      {/* Buffering / loading */}
      {isBusy && !errorMessage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 rounded-full p-4">
            <Loader2 size={40} className="text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Playback error - previously this was console-only, leaving a black rectangle */}
      {errorMessage && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 px-6">
          <div className="max-w-lg text-center">
            <AlertTriangle size={40} className="mx-auto mb-3 text-amber-400" />
            <p className="text-lg font-semibold text-white">Can't play this file</p>
            <p className="mt-2 text-sm text-gray-300">{errorMessage}</p>
            <p className="mt-3 text-xs text-gray-500 font-mono break-all">{fileName}</p>
          </div>
        </div>
      )}

      {/* Format warning: the browser says no before we stream anything */}
      {!errorMessage && formatWarning && (
        <div className="absolute top-4 left-4 z-30 max-w-sm bg-amber-950/90 border border-amber-800 text-amber-100 text-xs rounded-md px-3 py-2">
          This browser reports no support for <span className="font-mono">{formatWarning}</span>. Playback may fail.
        </div>
      )}

      {/* Resume notice.
          Centred by a full-width flex row rather than by -translate-x-1/2:
          Tailwind builds every transform out of custom properties, which
          Chromium 47 does not have, so on the TV this notice used to start at
          the middle of the screen and run off the right-hand edge. */}
      {resumedFrom !== null && !errorMessage && (
        <div ref={resumeNoticeRef} className={`absolute bottom-24 left-0 right-0 z-40 flex justify-center px-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="flex items-center space-x-3 bg-gray-900/95 border border-gray-700 rounded-full pl-4 pr-2 py-2">
            <span className="text-sm text-gray-200">Resumed from {formatTime(resumedFrom)}</span>
            <button
              onClick={startOver}
              className="text-xs font-semibold text-blue-300 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
            >
              Start over
            </button>
            <button
              onClick={() => setResumedFrom(null)}
              aria-label="Dismiss"
              className="text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full p-1"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Up next. Always visible while it counts, controls hidden or not - it is
          the one notice with a deadline. */}
      {upNextIn !== null && (
        <div ref={upNextRef} className="absolute bottom-24 left-0 right-0 z-40 flex justify-center px-4">
          <div className="flex items-center space-x-3 bg-gray-900/95 border border-gray-700 rounded-full pl-4 pr-2 py-2 max-w-full">
            <span className="text-sm text-gray-200 truncate">
              Up next in {upNextIn}s · <span className="text-white">{nextName}</span>
            </span>
            <button
              onClick={playNextNow}
              className="flex-none text-xs font-semibold text-blue-300 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
            >
              Play now
            </button>
            <button
              onClick={() => setUpNextIn(null)}
              className="flex-none text-xs text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      {/* Feedback Overlay */}
      {feedback && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 p-4 rounded-full text-white backdrop-blur-sm animate-ping">
            {feedback === 'forward-10' && <SkipForward size={32} />}
            {feedback === 'back-10' && <SkipBack size={32} />}
            {feedback === 'forward-15' && <SkipForward size={32} className="text-blue-400" />}
            {feedback === 'back-15' && <SkipBack size={32} className="text-blue-400" />}
          </div>
        </div>
      )}

      {/* Top Right Subtitle Menu.
          pointer-events-none while hidden, or an invisible button keeps taking
          clicks meant for the film - and keeps its place in the tab order, where
          a remote lands on a control nobody can see. */}
      <div className={`absolute top-4 right-4 z-50 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="relative" ref={subPanelRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowSubSettings(!showSubSettings); }}
            aria-label="Subtitles"
            aria-expanded={showSubSettings}
            title="Subtitles"
            className={`p-2 rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 hover:text-blue-400 focus:outline-none focus:bg-blue-700 transition ${showSubSettings ? 'text-blue-400 ring-2 ring-blue-500' : ''}`}
          >
            <Type size={20} />
          </button>

          {showSubSettings && (
            <div
              ref={subPanelBodyRef}
              className="absolute top-12 right-0 bg-gray-900/95 backdrop-blur rounded-lg p-4 w-72 max-w-[90vw] max-h-[60vh] overflow-y-auto shadow-2xl border border-gray-700"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-gray-400 mb-3 border-b border-gray-700 pb-1">Subtitles</h3>

              {/* Font Size Controls */}
              <div className="mb-4 space-y-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1 flex justify-between">
                    <span>Top Font Size</span>
                    <span className="font-mono">{topFontSize}px</span>
                  </label>
                  <input
                    type="range" min="12" max="48" step="2" value={topFontSize}
                    onChange={(e) => setTopFontSize(parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1 flex justify-between">
                    <span>Bottom Font Size</span>
                    <span className="font-mono">{bottomFontSize}px</span>
                  </label>
                  <input
                    type="range" min="12" max="48" step="2" value={bottomFontSize}
                    onChange={(e) => setBottomFontSize(parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <hr className="border-gray-700 mb-4" />

              {/* Top Subtitle Selection */}
              <div className="mb-2">
                <label className="text-xs text-blue-300 block mb-1">Top Source</label>
                <select
                  className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
                  value={topSubtitle?.path || ''}
                  onChange={(e) => {
                    const sub = availableSubtitles.find(s => s.path === e.target.value) || null;
                    setTopSubtitle(sub);
                    rememberPick(topPickStore, sub);
                  }}
                >
                  <option value="">Off</option>
                  {availableSubtitles.map(sub => (
                    <option key={'top-' + sub.path} value={sub.path}>{sub.name}</option>
                  ))}
                </select>
                {topSubtitle && <SyncRow offset={topOffset} onNudge={(d) => nudgeOffset('top', d)} />}
              </div>


              {/* Bottom Subtitle Selection */}
              <div className="mb-4">
                <label className="text-xs text-blue-300 block mb-1">Bottom Source</label>
                <select
                  className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
                  value={bottomSubtitle?.path || ''}
                  onChange={(e) => {
                    const sub = availableSubtitles.find(s => s.path === e.target.value) || null;
                    setBottomSubtitle(sub);
                    rememberPick(bottomPickStore, sub);
                  }}
                >
                  <option value="">Off</option>
                  {availableSubtitles.map(sub => (
                    <option key={'bottom-' + sub.path} value={sub.path}>{sub.name}</option>
                  ))}
                </select>
                {bottomSubtitle && <SyncRow offset={bottomOffset} onNudge={(d) => nudgeOffset('bottom', d)} />}
              </div>

              {/* Online subtitles. Hidden entirely when nothing at all is
                  configured - an empty menu that can never return anything is
                  worse than no menu, and local subtitle files still work without
                  any of this. The two halves come and go independently: the
                  search menu belongs to SUBTITLE_PROVIDERS, the ID box below to
                  SUBSCENE_URL, and neither setting has anything to say about the
                  other. */}
              {(subtitleFinder.ready || subsceneOffered) && (
                <>
                  <hr className="border-gray-700 mb-4" />

                  {subtitleFinder.ready && (
                  <div className="mb-2">
                    <label className="text-xs text-blue-300 block mb-1">Get subtitles</label>
                    <select
                      className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-blue-500 outline-none mb-2"
                      value={searchLanguage}
                      disabled={subtitleFinder.busy !== 'idle'}
                      onChange={(e) => handleLanguagePick(e.target.value)}
                    >
                      <option value="">Choose a language</option>
                      {subtitleFinder.languages.map(lang => (
                        <option key={'lang-' + lang.code} value={lang.code}>{lang.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={!searchLanguage || subtitleFinder.busy !== 'idle'}
                        onClick={handleDownload}
                        className="flex-1 text-xs px-2 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500 disabled:opacity-40"
                      >
                        {alreadyDownloaded.length > 0 ? 'Download another' : 'Download'}
                      </button>
                      <button
                        type="button"
                        disabled={!searchLanguage || subtitleFinder.busy !== 'idle'}
                        onClick={handleShowAll}
                        className="text-xs px-2 py-2 rounded border border-gray-700 text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40"
                      >
                        More
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Subscene: an id typed in by hand, because the site cannot be
                      searched from here. Its own control with its own setting, so
                      it is here whether or not anything above it is - and it stays
                      on screen, disabled with a reason, rather than vanishing when
                      SUBSCENE_URL is blank. There is nothing to sign up for. */}
                  <div className="mb-3">
                    <label className="text-xs text-gray-400 block mb-1" htmlFor="subscene-id">
                      Subscene ID
                      {subtitleFinder.subscene?.site && (
                        <span className="text-gray-500"> · {subtitleFinder.subscene.site}</span>
                      )}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        id="subscene-id"
                        type="text"
                        inputMode="numeric"
                        placeholder="e.g. 3358444"
                        value={subsceneBox.value}
                        aria-invalid={!subsceneReuse && SUBSCENE_LOOK[subsceneBox.state].invalid}
                        disabled={subsceneBox.state === 'off' || subtitleFinder.busy !== 'idle'}
                        onChange={(e) => subsceneBox.setValue(e.target.value)}
                        className={`flex-1 min-w-0 bg-gray-800 text-white text-xs p-2 rounded border outline-none ${subsceneLook.border}`}
                      />
                      {/* Blue like Download above, because it does the same kind of
                          thing. It read as permanently disabled while it was the
                          only outline button in the panel. */}
                      {/* A file already here needs no verdict from the site, so
                          this is offered while the check is still running - and
                          says what it will do, since it no longer downloads. */}
                      <button
                        type="button"
                        disabled={subtitleFinder.busy !== 'idle'
                          || (!subsceneReuse && CAN_FETCH.indexOf(subsceneBox.state) === -1)}
                        onClick={handleSubsceneFetch}
                        className="text-xs px-3 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500 disabled:opacity-40"
                      >
                        {subsceneReuse ? 'Use it' : 'Get'}
                      </button>
                    </div>
                    <div className={`text-xs mt-1 break-words ${subsceneLook.text}`}>
                      {subsceneSaid}
                    </div>
                  </div>

                  {/* What is already here, so "Download another" is a decision rather
                      than a surprise - each one of these cost a download. Listed and
                      not clickable on purpose: the Source menus above are the one
                      place a subtitle gets put on screen. */}
                  {searchLanguage && alreadyDownloaded.length > 0 && (
                    <div className="text-xs text-gray-400 mb-3">
                      <div className="mb-1">
                        Already downloaded ({alreadyDownloaded.length}):
                      </div>
                      <ul className="space-y-1">
                        {alreadyDownloaded.map(({ node }) => (
                          <li key={node.path} className="text-gray-500 truncate">{node.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {subtitleFinder.busy !== 'idle' && (
                    <div className="text-xs text-gray-300 flex items-center space-x-2 mb-2">
                      <Loader2 size={12} className="animate-spin" />
                      <span>{subtitleFinder.busy === 'searching' ? 'Searching…' : 'Downloading…'}</span>
                    </div>
                  )}

                  {/* A source being down is temporary and self-explanatory, so it
                      fades; a failed download is something the user must act on,
                      so it stays. */}
                  {subtitleFinder.notice && (
                    <div className="text-xs text-amber-300 mb-2">{subtitleFinder.notice}</div>
                  )}
                  {subtitleFinder.error && (
                    <div className="text-xs text-red-400 mb-2">{subtitleFinder.error}</div>
                  )}

                  {/* Free accounts get a handful of downloads a day, so "try
                      another one" needs to be a decision, not a surprise. */}
                  {subtitleFinder.quota && (
                    <div className="text-xs text-gray-500 mb-2">
                      {subtitleFinder.quota.remaining} download{subtitleFinder.quota.remaining === 1 ? '' : 's'} left today
                      {subtitleFinder.quota.key && ` on ${subtitleFinder.quota.key}`}
                    </div>
                  )}

                  {/* Real buttons, so the whole list is reachable from a remote. */}
                  {showCandidates && subtitleFinder.candidates.length > 0 && (
                    <div className="border-t border-gray-700 pt-2">
                      <div className="text-xs text-gray-400 mb-1">
                        Pick one to download
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {subtitleFinder.candidates.map(candidate => (
                          <button
                            key={candidate.provider + '-' + candidate.ref}
                            type="button"
                            onClick={() => handleTakeCandidate(candidate)}
                            disabled={subtitleFinder.busy !== 'idle'}
                            className="w-full text-left text-xs p-2 rounded text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white disabled:opacity-40"
                          >
                            <span className="block truncate">
                              {candidate.release || candidate.fileName || 'Untitled'}
                            </span>
                            <span className="block text-gray-500 truncate">
                              {candidate.provider}
                              {candidate.tier === 0 && ' · matches this exact file'}
                              {candidate.tier === 1 && ' · matches this release'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {availableSubtitles.length === 0 && subtitleFinder.busy === 'idle' && (
                <div className="text-xs text-gray-500 italic mt-2">
                  {subtitleFinder.ready
                    ? 'No subtitle files in this folder. Pick a language above to search online.'
                    : 'No subtitle files found in video folder.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      {/* bg-black/70 is the fallback scrim: Tailwind gradients are custom-property
          based, so on old TV browsers the gradient drops out entirely and the
          controls would sit unreadable directly on the video. background-color is
          painted over by background-image wherever the gradient does work. */}
      {/* pointer-events-none while hidden: the bar covers the bottom of the
          picture, so an invisible one used to swallow every click aimed at the
          film underneath it and leave its buttons in the tab order. */}
      <div ref={controlBarRef} className={`absolute bottom-0 left-0 right-0 bg-black/70 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 transition-opacity duration-300 z-40 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* Progress */}
        <div className="flex items-center space-x-2 mb-2 group/progress">
          <span ref={timeLabelRef} className="text-xs text-gray-300 font-mono w-10 text-right">{formatTime(0)}</span>
          <div className="relative flex-1 flex items-center">
            {/* How much is already downloaded, painted behind the slider. */}
            <div className="absolute left-0 right-0 h-1 bg-gray-600 rounded-lg overflow-hidden pointer-events-none">
              <div ref={bufferedRef} className="h-full bg-gray-400" style={{ width: '0%' }} />
            </div>
            <input
              ref={progressRef}
              type="range"
              min="0"
              max={duration || 100}
              step="any"
              defaultValue={0}
              onMouseDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              onChange={handleScrubChange}
              onMouseUp={handleScrubCommit}
              onTouchEnd={handleScrubCommit}
              onBlur={handleScrubCommit}
              aria-label="Seek"
              className="relative flex-1 h-1 bg-transparent rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-red-600 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:w-4 hover:[&::-webkit-slider-thumb]:h-4 transition-all"
            />
          </div>
          <span className="text-xs text-gray-300 font-mono w-10">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {onPrevious && (
              <button onClick={onPrevious} title="Previous (p)" aria-label="Previous"
                className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition">
                <ChevronLeft size={22} />
              </button>
            )}
            <button onClick={() => skip(-10)} aria-label="Back 10 seconds" className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition flex flex-col items-center space-y-0.5 group">
              <RotateCcw size={20} />
              <span className="text-[10px] -mt-1 font-bold group-hover:text-blue-400">10</span>
            </button>
            <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition transform hover:scale-110 mx-2">
              {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
            </button>
            <button onClick={() => skip(10)} aria-label="Forward 10 seconds" className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition flex flex-col items-center space-y-0.5 group">
              <RotateCw size={20} />
              <span className="text-[10px] -mt-1 font-bold group-hover:text-blue-400">10</span>
            </button>
            {onNext && (
              <button onClick={onNext} title="Next (n)" aria-label="Next"
                className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition">
                <ChevronRight size={22} />
              </button>
            )}

            <div className="flex items-center space-x-2 group/volume ml-4">
              <button onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded">
                {isMuted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
              </button>
              <input
                type="range" min="0" max="1" step="0.05"
                value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                aria-label="Volume"
                className="w-0 overflow-hidden group-hover/volume:w-24 focus:w-24 transition-all h-1 bg-gray-500 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            {/* Speed Control */}
            <button onClick={cyclePlaybackRate} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded ml-4 flex items-center space-x-1 min-w-[3rem]" title="Playback Speed">
              <Gauge size={20} />
              <span className="text-xs font-bold">{playbackRate}x</span>
            </button>
            <div className="text-white ml-4 truncate max-w-[150px] text-sm font-medium opacity-80" title={fileName || ''}>{fileName}</div>
          </div>

          <div className="flex items-center space-x-4">
            {/* The only route to the shortcut list on a remote: "?" needs a
                Shift the TV browser cannot report. */}
            <button
              onClick={() => setShowHelp(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition"
            >
              <Keyboard size={22} />
            </button>
            <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition">
              {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Shortcut sheet. Above everything, and closed by the backdrop, the X or
          Escape - three ways out, because one of them has to be the one the
          thing in your hand can do. */}
      {showHelp && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-4"
          onClick={() => setShowHelp(false)}
        >
          {/* max-h-full against a padded parent rather than a percentage: the
              whole sheet fits in a normal player pane instead of clipping its
              last line, and still scrolls where it cannot. */}
          <div
            className="w-full max-w-lg max-h-full overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Keyboard &amp; remote</h3>
              <button
                onClick={() => setShowHelp(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 rounded p-1"
              >
                <X size={16} />
              </button>
            </div>

            <ul className="space-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <li key={keys} className="flex items-baseline justify-between text-sm">
                  <span className="font-mono text-blue-300 flex-none mr-4">{keys}</span>
                  <span className="text-gray-300 text-right">{what}</span>
                </li>
              ))}
            </ul>

            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mt-5 mb-2 border-t border-gray-700 pt-4">
              Mouse &amp; touch
            </h3>
            <ul className="space-y-1.5">
              {GESTURES.map(([how, what]) => (
                <li key={how} className="flex items-baseline justify-between text-sm">
                  <span className="text-blue-300 flex-none mr-4">{how}</span>
                  <span className="text-gray-300 text-right">{what}</span>
                </li>
              ))}
            </ul>

            <p className="text-xs text-gray-500 mt-5">
              The remote's play, pause, stop, rewind and fast-forward buttons work too -
              rewind and fast-forward move 10 seconds.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Memoized, and every prop above is a primitive or a stable identity for it.
 *
 * The library re-reads playback positions every few seconds now, so `App`
 * re-renders while a film plays where it used to sit still. Without this that
 * would put the whole player - the control bar, both Source menus and every
 * option in them - back on the same treadmill that writing the clock straight to
 * the DOM was meant to get it off.
 */
export const MediaPlayer = React.memo(MediaPlayerView);
