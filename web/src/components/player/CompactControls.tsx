import React, { useEffect, useRef, useState } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, RotateCcw, RotateCw,
  SkipBack, SkipForward, MoreHorizontal, Keyboard, Gauge,
} from 'lucide-react';
import { formatTime } from '../../utils/time';
import { normalizeKey } from '../../utils/keys';

interface CompactControlsProps {
  /** The bottom strip: measured, like the full bar, so the cue clears it. */
  barRef: React.RefObject<HTMLDivElement>;
  progressRef: React.RefObject<HTMLInputElement>;
  timeLabelRef: React.RefObject<HTMLSpanElement>;
  totalLabelRef: React.RefObject<HTMLButtonElement>;
  playedRef: React.RefObject<HTMLDivElement>;
  bufferedRef: React.RefObject<HTMLDivElement>;
  visible: boolean;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  showRemaining: boolean;
  onToggleRemaining: () => void;
  subtitles?: React.ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  onSkip: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onCycleRate: () => void;
  onShowHelp: () => void;
  onToggleFullscreen?: () => void;
  onScrubStart: () => void;
  onScrubChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScrubCommit: (e: React.SyntheticEvent<HTMLInputElement>) => void;
}

const ROUND = 'rounded-full bg-black/60 text-white focus:outline-none focus:bg-blue-700';

/**
 * The controls on a phone, laid over the picture the way phone players do: play
 * and the 10-second skips in the middle, the time and Fullscreen along the
 * bottom, the seek bar on the bottom edge. Everything fits at 360px - the full
 * bar ran off the right of a 390px screen, Fullscreen and all.
 *
 * Volume (a phone has buttons for it), speed and the shortcut sheet are in the
 * ⋯ menu. The layer itself lets taps through, so tap and double-tap on the
 * picture work as before; only the buttons take them, and only while showing.
 */
export const CompactControls: React.FC<CompactControlsProps> = ({
  barRef, progressRef, timeLabelRef, totalLabelRef, playedRef, bufferedRef, visible, duration, isPlaying,
  isMuted, playbackRate, isFullscreen, showRemaining, onToggleRemaining, subtitles, onPrevious, onNext,
  onSkip, onTogglePlay, onToggleMute, onCycleRate, onShowHelp, onToggleFullscreen,
  onScrubStart, onScrubChange, onScrubCommit,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // Hidden controls take nothing: the same rule as the full bar.
  const live = visible ? 'pointer-events-auto' : 'pointer-events-none';

  useEffect(() => { if (!visible) setMoreOpen(false); }, [visible]);
  useEffect(() => {
    if (!moreOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => { if (normalizeKey(e) === 'Escape' || normalizeKey(e) === 'Back') setMoreOpen(false); };
    document.addEventListener('click', onClickAway);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('click', onClickAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, [moreOpen]);

  return (
    <div className={`absolute inset-0 z-40 pointer-events-none transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        {onPrevious && (
          <button onClick={onPrevious} aria-label="Previous" className={`${ROUND} ${live} p-2 mr-4`}>
            <SkipBack size={18} />
          </button>
        )}
        <button onClick={() => onSkip(-10)} aria-label="Back 10 seconds" className={`${ROUND} ${live} p-2 mr-5`}>
          <RotateCcw size={22} />
        </button>
        <button onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className={`${ROUND} ${live} p-3`}>
          {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
        </button>
        <button onClick={() => onSkip(10)} aria-label="Forward 10 seconds" className={`${ROUND} ${live} p-2 ml-5`}>
          <RotateCw size={22} />
        </button>
        {onNext && (
          <button onClick={onNext} aria-label="Next" className={`${ROUND} ${live} p-2 ml-4`}>
            <SkipForward size={18} />
          </button>
        )}
      </div>

      <div ref={barRef} className="absolute bottom-0 left-0 right-0 bg-black/60 bg-gradient-to-t from-black/80 to-transparent pt-4">
        <div className="flex items-center px-3">
          <span ref={timeLabelRef} className="text-xs text-gray-200 font-mono">{formatTime(0)}</span>
          <span className="mx-1 text-xs text-gray-400">/</span>
          <button
            ref={totalLabelRef}
            type="button"
            onClick={onToggleRemaining}
            aria-label={showRemaining ? 'Time left; show the length' : 'Length; show the time left'}
            className={`text-xs text-gray-300 font-mono rounded focus:outline-none focus:bg-blue-700 ${live}`}
          >
            {showRemaining ? `−${formatTime(duration)}` : formatTime(duration)}
          </button>

          <div className={`ml-auto flex items-center ${live}`}>
            {subtitles}
            <div className="relative ml-2" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreOpen(open => !open)}
                aria-label="More controls"
                aria-expanded={moreOpen}
                className="p-1 rounded text-white focus:outline-none focus:bg-blue-700"
              >
                <MoreHorizontal size={22} />
              </button>
              {moreOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-48 rounded-lg bg-gray-900 border border-gray-700 shadow-2xl py-1 text-sm">
                  <button type="button" onClick={() => { onToggleMute(); setMoreOpen(false); }}
                    className="w-full flex items-center px-3 py-2 text-left text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700">
                    {isMuted ? <VolumeX size={16} className="mr-2" /> : <Volume2 size={16} className="mr-2" />}
                    {isMuted ? 'Unmute' : 'Mute'}
                  </button>
                  <button type="button" onClick={onCycleRate} aria-label={`Playback speed ${playbackRate}x`}
                    className="w-full flex items-center px-3 py-2 text-left text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700">
                    <Gauge size={16} className="mr-2" />
                    Speed <span className={`ml-auto font-semibold ${playbackRate === 1 ? 'text-gray-400' : 'text-blue-300'}`}>{playbackRate}×</span>
                  </button>
                  <button type="button" onClick={() => { onShowHelp(); setMoreOpen(false); }}
                    className="w-full flex items-center px-3 py-2 text-left text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700">
                    <Keyboard size={16} className="mr-2" />
                    Keyboard shortcuts
                  </button>
                </div>
              )}
            </div>
            {onToggleFullscreen && (
              <button onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className="ml-2 p-1 rounded text-white focus:outline-none focus:bg-blue-700">
                {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
              </button>
            )}
          </div>
        </div>

        {/* On the bottom edge, as wide as the picture. */}
        <div className={`relative h-5 flex items-center ${live}`}>
          <div className="absolute left-0 right-0 top-1/2 -mt-0.5 h-1 bg-gray-700 overflow-hidden pointer-events-none">
            <div ref={bufferedRef} className="absolute inset-y-0 left-0 bg-gray-500" style={{ width: '0%' }} />
            <div ref={playedRef} className="absolute inset-y-0 left-0 bg-blue-500" style={{ width: '0%' }} />
          </div>
          <input
            ref={progressRef}
            type="range"
            min="0"
            max={duration && isFinite(duration) ? duration : 100}
            step="any"
            defaultValue={0}
            onMouseDown={onScrubStart}
            onTouchStart={onScrubStart}
            onChange={onScrubChange}
            onMouseUp={onScrubCommit}
            onTouchEnd={onScrubCommit}
            onBlur={onScrubCommit}
            aria-label="Seek"
            className="relative w-full h-5 bg-transparent appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:rounded-full"
          />
        </div>
      </div>
    </div>
  );
};
