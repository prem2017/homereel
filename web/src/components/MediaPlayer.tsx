import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Volume2, Type, SkipForward, SkipBack, Loader2 } from 'lucide-react';
import { formatTime } from '../utils/time';
import { safePlay } from '../utils/media';
import { readPref, writePref, PREF } from '../utils/prefs';
import { resumeStore, durationStore, watchedStore, isResumable, isFinishedAt } from '../utils/resume';
import { reportToServer } from '../utils/remoteLog';
import { describePlaybackError, PlaybackProblem } from '../utils/playbackError';
import { getStreamUrl } from '../services/api';
import { FileNode } from '../types';
import { CueText } from './player/CueText';
import { ControlBar } from './player/ControlBar';
import { SubtitlePanel } from './player/SubtitlePanel';
import { ShortcutSheet } from './player/ShortcutSheet';
import { ResumeNotice, UpNextNotice } from './player/Notices';
import { ProblemOverlay } from './player/ProblemOverlay';
import { useSubtitleSlots } from './player/useSubtitleSlots';
import { useOnlineSubtitles } from './player/useOnlineSubtitles';
import { useCuePlacement } from './player/useCuePlacement';
import { useFullscreen } from './player/useFullscreen';
import { usePlayerKeys } from './player/usePlayerKeys';

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
  /** Open the library at this file. A stable callback, like the others. */
  onReveal?: (path: string) => void;
}

type Status = 'idle' | 'loading' | 'buffering' | 'ready' | 'error';

const HIDE_CONTROLS_AFTER = 2500;
const GESTURE_WINDOW = 300;

// How far playback moves between saves of the resume position. Which positions
// are worth resuming is `isResumable`, shared with the library's list.
const RESUME_SAVE_EVERY = 5;

// Long enough to reach for the remote, short enough not to feel like a wait.
const UP_NEXT_SECONDS = 6;

const MediaPlayerView: React.FC<MediaPlayerProps> = ({
  filePath, fileName, mimeType, siblings = [], onEnded, autoPlay, onNext, onPrevious,
  nextName, onSubtitlesSaved, onProgress, onReveal
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
  const [playbackRate, setPlaybackRate] = useState(() => readPref(PREF.rate, 1));
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef, videoRef);

  // Playback status
  const [status, setStatus] = useState<Status>('idle');
  // What went wrong, worded for this file, and the browser's code for it.
  const [problem, setProblem] = useState<{ said: PlaybackProblem; code: number | null } | null>(null);
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

  // Subtitle state: what each slot shows and how far it is shifted, and the
  // online sources that add files to the folder (useSubtitleSlots,
  // useOnlineSubtitles).
  const slots = useSubtitleSlots({ filePath, fileName, siblings, videoRef });
  const { bottomSubtitle, nudgeOffset, restartCueScan } = slots;
  const online = useOnlineSubtitles({
    filePath, availableSubtitles: slots.availableSubtitles, filePathRef: slots.filePathRef,
    fillBottom: slots.fillBottom, onSubtitlesSaved,
  });

  const isVideoFile = !!filePath && !mimeType?.startsWith('audio');

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

  // Where both subtitles sit, measured against the picture and every overlay in
  // the bottom strip - see useCuePlacement. `topSubtitleRef` places the overlay.
  const { topSubtitleRef } = useCuePlacement({
    videoRef, styleRef, controlBarRef, resumeNoticeRef, upNextRef, subPanelBodyRef,
    bottomFontSize, showControls, filePath, resumedFrom, upNextIn, showSubSettings, isFullscreen,
  });

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
      setProblem(null);
      setResumedFrom(null);
      // The last file's length and position, until this one reports its own -
      // a file that never loads would otherwise wear them.
      setDuration(0);
      if (progressRef.current) progressRef.current.value = '0';
      if (timeLabelRef.current) timeLabelRef.current.textContent = formatTime(0);
      // Whatever was queued belongs to the file that just finished.
      setUpNextIn(null);
      restartCueScan();
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
      restartCueScan();
    }
  }, [restartCueScan]);

  const seekTo = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      restartCueScan();
    }
  }, [restartCueScan]);

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

  const [feedback, setFeedback] = useState<string | null>(null);
  const showFeedbackIcon = useCallback((type: string) => {
    setFeedback(type);
    setTimeout(() => setFeedback(null), 800);
  }, []);

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

  // Keyboard + TV remote - and the shortcut sheet's list, kept beside it.
  usePlayerKeys({
    filePath, videoRef, togglePlay, skip, seekTo, changeVolume, toggleMute, toggleFullscreen,
    onNext, onPrevious, nudgeOffset, bottomSubtitle, setIsPlaying, showFeedbackIcon,
    setShowHelp, setShowSubSettings, showHelpRef, showSubSettingsRef,
  });

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

    slots.updateTopCue(t);

    // Distance, not elapsed time: a seek backwards used to leave the saved
    // position ahead of where playback actually was, and it stayed there until
    // the film caught up - so quitting after a rewind came back to the wrong
    // place, and the library's bar sat still for as long as it took.
    if (filePath && Math.abs(t - lastSavedRef.current) >= RESUME_SAVE_EVERY) {
      lastSavedRef.current = t;
      resumeStore.write(filePath, t);
      // Into the credits counts as finished: that is where people stop.
      if (isVideoFile && isFinishedAt(t, video.duration) && !watchedStore.read(filePath)) {
        watchedStore.write(filePath, Date.now());
      }
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
      restartCueScan();
      setResumedFrom(saved);
    }
  };

  const handleDurationChange = () => {
    if (videoRef.current) setDuration(videoRef.current.duration);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    // Finished means there is nothing to come back to - and the library has to
    // hear about the removal as well as the writes, or the row stays. It does
    // remember that this one was seen to the end.
    if (filePath) {
      resumeStore.write(filePath, null);
      if (isVideoFile) watchedStore.write(filePath, Date.now());
      onProgress?.();
    }

    // Said out loud before it happens, when there is somewhere to go. The jump
    // to the next episode was instant and silent, which is fine when it is what
    // you wanted and impossible to stop when it is not.
    //
    // Not between songs: an album is meant to run on, and six seconds of silence
    // with a notice over it between every track is a fault, not a courtesy.
    if (nextName && onEnded && !mimeType?.startsWith('audio')) {
      setUpNextIn(UP_NEXT_SECONDS);
      return;
    }
    onEnded && onEnded();
  };

  // The same file again, from wherever the browser had got to. A network drop
  // is the case it is for; a codec it cannot decode fails the same way twice.
  const retry = () => {
    const media = videoRef.current;
    if (!media) return;
    setProblem(null);
    setStatus('loading');
    media.load();
    safePlay(media);
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
      watchedStore.write(filePath, null);
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
      const code = e.currentTarget.error?.code;
      const said = describePlaybackError(code, fileName, mimeType);
      setStatus('error');
      setProblem({ said, code: code || null });
      // The TV browser has no devtools, so the server log is the only place this can
      // be read back from.
      reportToServer(`TV Video Error: code ${code} on file: ${filePath} (${mimeType}) - ${said.title}. ${said.detail}`);
      console.error('Video Error:', said.title);
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
          {slots.bottomSubtitleSrc && slots.bottomSubtitleSrc.filePath === filePath && (
            <track
              key={slots.bottomSubtitleSrc.url} // Force re-render on change
              label="Bottom"
              kind="subtitles"
              srcLang="en"
              src={slots.bottomSubtitleSrc.url}
              default
            />
          )}
        </video>
      )}

      {/* Top Subtitle Custom Overlay.
          top-10 is the fallback for the frame before the film's shape is known;
          placeTopSubtitle overwrites it with the top of the picture, which in a
          letterboxed window is a long way down from the top of the element. */}
      {slots.currentTopText && (
        <div ref={topSubtitleRef} className="absolute top-10 left-0 right-0 z-20 text-center pointer-events-none">
          <span
            className="bg-black/75 text-white px-3 py-1.5 rounded leading-relaxed inline-block max-w-[80%] whitespace-pre-wrap"
            style={{ fontSize: `${topFontSize}px` }}
          >
            <CueText text={slots.currentTopText} />
          </span>
        </div>
      )}

      {/* Buffering / loading */}
      {isBusy && !problem && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 rounded-full p-4">
            <Loader2 size={40} className="text-white animate-spin" />
          </div>
        </div>
      )}

      {problem && (
        <ProblemOverlay
          problem={problem} fileName={fileName} filePath={filePath}
          onReveal={onReveal} onRetry={retry} onNext={onNext}
        />
      )}

      {/* Format warning: the browser says no before we stream anything */}
      {!problem && formatWarning && (
        <div className="absolute top-4 left-4 z-30 max-w-sm bg-amber-950/90 border border-amber-800 text-amber-100 text-xs rounded-md px-3 py-2">
          This browser reports no support for <span className="font-mono">{formatWarning}</span>. Playback may fail.
        </div>
      )}

      {resumedFrom !== null && !problem && (
        <ResumeNotice
          noticeRef={resumeNoticeRef} visible={showControls} resumedFrom={resumedFrom}
          onStartOver={startOver} onDismiss={() => setResumedFrom(null)}
        />
      )}

      {upNextIn !== null && (
        <UpNextNotice
          noticeRef={upNextRef} seconds={upNextIn} nextName={nextName}
          onPlayNow={playNextNow} onStay={() => setUpNextIn(null)}
        />
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
            <SubtitlePanel
              bodyRef={subPanelBodyRef} slots={slots} online={online}
              topFontSize={topFontSize} onTopFontSize={setTopFontSize}
              bottomFontSize={bottomFontSize} onBottomFontSize={setBottomFontSize}
            />
          )}
        </div>
      </div>

      <ControlBar
        barRef={controlBarRef} progressRef={progressRef} timeLabelRef={timeLabelRef} bufferedRef={bufferedRef}
        visible={showControls} duration={duration} isPlaying={isPlaying} isMuted={isMuted} volume={volume}
        playbackRate={playbackRate} isFullscreen={isFullscreen} fileName={fileName}
        onPrevious={onPrevious} onNext={onNext} onSkip={skip} onTogglePlay={togglePlay} onToggleMute={toggleMute}
        onVolumeChange={handleVolumeChange} onCycleRate={cyclePlaybackRate} onShowHelp={() => setShowHelp(true)}
        onToggleFullscreen={toggleFullscreen}
        onScrubStart={handleScrubStart} onScrubChange={handleScrubChange} onScrubCommit={handleScrubCommit}
      />

      {showHelp && <ShortcutSheet onClose={() => setShowHelp(false)} />}
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
