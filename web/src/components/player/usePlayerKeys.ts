import React, { useEffect } from 'react';
import { normalizeKey } from '../../utils/keys';
import { safePlay, fullscreenElement } from '../../utils/media';
import { FileNode } from '../../types';
import { OFFSET_FINE_STEP, SubtitleSlot } from './useSubtitleSlots';

// What the key handler below actually implements, and the gestures the player's
// click handler implements (handleContainerClick in MediaPlayer.tsx). Kept beside
// the handler so the two cannot drift, and shown on demand because until now none
// of it appeared anywhere on screen: half the player was invisible unless you had
// read the source.
//
// Plain words rather than the media-key glyphs - an old TV font has no idea what
// those are and draws a box.
export const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play or pause'],
  ['Left / Right', 'Back or forward 5 seconds'],
  ['Up / Down', 'Volume'],
  ['m', 'Mute'],
  ['f', 'Fullscreen (Esc or Back leaves it)'],
  ['n / p', 'Next or previous file in the folder'],
  ['g / h', 'Subtitle 0.1s earlier or later'],
  ['c', 'Bottom subtitle off, or back on'],
  ['t', 'Top subtitle off, or back on'],
  ['0 - 9', 'Jump to that tenth of the file'],
  ['?', 'This list'],
];

export const GESTURES: Array<[string, string]> = [
  ['Click the middle', 'Play or pause'],
  ['Double-click a side', 'Skip 10 seconds that way'],
  ['Triple-click a side', 'Skip 15 seconds that way'],
];

/** The player's keyboard and TV-remote handling, on the window. */
export const usePlayerKeys = ({
  filePath, videoRef, togglePlay, skip, seekTo, changeVolume, toggleMute, toggleFullscreen,
  onNext, onPrevious, nudgeOffset, bottomSubtitle, setIsPlaying, showFeedbackIcon, toggleSubtitle,
  setShowHelp, setShowSubSettings, showHelpRef, showSubSettingsRef,
}: {
  filePath: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  togglePlay: () => void;
  skip: (seconds: number) => void;
  seekTo: (seconds: number) => void;
  changeVolume: (delta: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  nudgeOffset: (slot: SubtitleSlot, delta: number) => void;
  bottomSubtitle: FileNode | null;
  setIsPlaying: (playing: boolean) => void;
  showFeedbackIcon: (type: string) => void;
  toggleSubtitle: (slot: SubtitleSlot) => void;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSubSettings: (open: boolean) => void;
  showHelpRef: React.MutableRefObject<boolean>;
  showSubSettingsRef: React.MutableRefObject<boolean>;
}) => {
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

        // A slot off and back on, without opening the panel - recorded like a
        // pick from its menu, so it stays that way for this film.
        case 'c': toggleSubtitle('bottom'); break;
        case 't': toggleSubtitle('top'); break;

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
  }, [filePath, togglePlay, skip, seekTo, changeVolume, toggleMute, toggleFullscreen, onNext, onPrevious, nudgeOffset, bottomSubtitle, toggleSubtitle]);
};
