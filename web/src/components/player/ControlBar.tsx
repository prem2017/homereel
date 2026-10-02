import React from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, RotateCcw, RotateCw,
  ChevronLeft, ChevronRight, Keyboard,
} from 'lucide-react';
import { formatTime } from '../../utils/time';

interface ControlBarProps {
  /** Measured: the bottom subtitle is lifted clear of the bar. */
  barRef: React.RefObject<HTMLDivElement>;
  /** Written to directly during playback instead of through props - see the
   *  player's handleTimeUpdate. The played and buffered stretches are widths. */
  progressRef: React.RefObject<HTMLInputElement>;
  timeLabelRef: React.RefObject<HTMLSpanElement>;
  totalLabelRef: React.RefObject<HTMLButtonElement>;
  playedRef: React.RefObject<HTMLDivElement>;
  bufferedRef: React.RefObject<HTMLDivElement>;
  visible: boolean;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
  isFullscreen: boolean;
  /** The total reads as time left ("−1:18"), remembered in prefs. */
  showRemaining: boolean;
  onToggleRemaining: () => void;
  /** The subtitle button and its panel, which opens above it. */
  subtitles?: React.ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  onSkip: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCycleRate: () => void;
  onShowHelp?: () => void;
  onToggleFullscreen?: () => void;
  onScrubStart: () => void;
  onScrubChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScrubCommit: (e: React.SyntheticEvent<HTMLInputElement>) => void;
}

const BUTTON = 'text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition';

/** The time under the pointer, written straight to the label: no state, so
 *  moving over the bar costs the memoized player nothing. */
const showHoverTime = (e: React.MouseEvent<HTMLDivElement>, duration: number) => {
  const label = e.currentTarget.querySelector<HTMLElement>('[data-hover-time]');
  if (!label || !duration || !isFinite(duration)) return;
  const box = e.currentTarget.getBoundingClientRect();
  const x = Math.min(box.width, Math.max(0, e.clientX - box.left));
  label.textContent = formatTime((x / box.width) * duration);
  const half = label.offsetWidth / 2;
  label.style.left = `${Math.min(box.width - label.offsetWidth, Math.max(0, x - half))}px`;
};

/**
 * Seek bar and buttons along the foot of the picture.
 *
 * The seek bar fills the part already played in blue over the buffered grey -
 * the dot alone used to be the only mark of where you were, and the grey ahead
 * of it read as progress. Both widths are written through refs, like the clock.
 *
 * bg-black/70 is the fallback scrim: Tailwind gradients are custom-property
 * based, so on old TV browsers the gradient drops out entirely and the controls
 * would sit unreadable directly on the video. background-color is painted over by
 * background-image wherever the gradient does work.
 *
 * pointer-events-none while hidden: the bar covers the bottom of the picture, so
 * an invisible one used to swallow every click aimed at the film underneath it
 * and leave its buttons in the tab order.
 */
export const ControlBar: React.FC<ControlBarProps> = ({
  barRef, progressRef, timeLabelRef, totalLabelRef, playedRef, bufferedRef, visible, duration,
  isPlaying, isMuted, volume, playbackRate, isFullscreen, showRemaining, onToggleRemaining, subtitles,
  onPrevious, onNext, onSkip, onTogglePlay, onToggleMute, onVolumeChange, onCycleRate, onShowHelp,
  onToggleFullscreen, onScrubStart, onScrubChange, onScrubCommit,
}) => (
  <div ref={barRef} className={`absolute bottom-0 left-0 right-0 bg-black/70 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 sm:px-4 pt-2 pb-3 transition-opacity duration-300 z-40 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
    {/* Progress */}
    <div className="flex items-center mb-1">
      <span ref={timeLabelRef} className="flex-none text-xs text-gray-300 font-mono w-12 text-right mr-2">{formatTime(0)}</span>
      <div className="relative flex-1 h-5 flex items-center group/seek" onMouseMove={(e) => showHoverTime(e, duration)}>
        <div className="absolute left-0 right-0 h-1 bg-gray-700 rounded-lg overflow-hidden pointer-events-none">
          {/* How much is already downloaded, then how much has been played. */}
          <div ref={bufferedRef} className="absolute inset-y-0 left-0 bg-gray-500" style={{ width: '0%' }} />
          <div ref={playedRef} className="absolute inset-y-0 left-0 bg-blue-500" style={{ width: '0%' }} />
        </div>
        <span
          data-hover-time=""
          className="absolute bottom-full mb-1 px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-xs text-white font-mono opacity-0 group-hover/seek:opacity-100 pointer-events-none"
          style={{ left: 0 }}
        />
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
          className="relative flex-1 h-1 bg-transparent rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:w-4 hover:[&::-webkit-slider-thumb]:h-4 transition-all"
        />
      </div>
      {/* Pressed, the total becomes the time left; written by the player while
          it shows that, since it changes every second. */}
      <button
        ref={totalLabelRef}
        type="button"
        onClick={onToggleRemaining}
        title={showRemaining ? 'Show the length' : 'Show the time left'}
        aria-label={showRemaining ? 'Time left; show the length' : 'Length; show the time left'}
        className="flex-none text-xs text-gray-300 font-mono w-14 text-left ml-2 hover:text-white focus:outline-none focus:bg-blue-700 rounded"
      >
        {showRemaining ? `−${formatTime(duration)}` : formatTime(duration)}
      </button>
    </div>

    {/* Buttons */}
    <div className="flex items-center justify-between">
      <div className="flex items-center min-w-0">
        {onPrevious && (
          <button onClick={onPrevious} title="Previous (p)" aria-label="Previous" className={`${BUTTON} mr-3`}>
            <ChevronLeft size={22} />
          </button>
        )}
        <button onClick={() => onSkip(-10)} aria-label="Back 10 seconds" className={`${BUTTON} flex flex-col items-center space-y-0.5 group/skip mr-3`}>
          <RotateCcw size={20} />
          <span className="text-[10px] -mt-1 font-bold group-hover/skip:text-blue-400">10</span>
        </button>
        <button onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className={`${BUTTON} mr-3`}>
          {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
        </button>
        <button onClick={() => onSkip(10)} aria-label="Forward 10 seconds" className={`${BUTTON} flex flex-col items-center space-y-0.5 group/skip mr-3`}>
          <RotateCw size={20} />
          <span className="text-[10px] -mt-1 font-bold group-hover/skip:text-blue-400">10</span>
        </button>
        {onNext && (
          <button onClick={onNext} title="Next (n)" aria-label="Next" className={`${BUTTON} mr-3`}>
            <ChevronRight size={22} />
          </button>
        )}

        {/* A phone has buttons for its volume, and no room. */}
        <div className="hidden sm:flex items-center space-x-2 group/volume ml-2">
          <button onClick={onToggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} className={BUTTON}>
            {isMuted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
          <input
            type="range" min="0" max="1" step="0.05"
            value={isMuted ? 0 : volume} onChange={onVolumeChange}
            aria-label="Volume"
            className="w-0 overflow-hidden group-hover/volume:w-24 focus:w-24 transition-all h-1 bg-gray-500 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <div className="flex items-center flex-none">
        {subtitles}
        {/* A chip, lit only when it is not 1x - the one setting easy to leave
            on by accident. */}
        <button
          onClick={onCycleRate}
          title="Playback speed"
          aria-label={`Playback speed ${playbackRate}x`}
          className={`ml-3 text-xs font-semibold px-2 py-0.5 rounded-full border focus:outline-none focus:bg-blue-700 focus:text-white ${playbackRate === 1 ? 'border-gray-600 text-gray-300 hover:text-white' : 'border-blue-400 bg-blue-900 text-blue-200'}`}
        >
          {playbackRate}×
        </button>
        {/* The only route to the shortcut list on a remote: "?" needs a
            Shift the TV browser cannot report. */}
        {onShowHelp && (
          <button onClick={onShowHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className={`${BUTTON} ml-3 hidden sm:block`}>
            <Keyboard size={22} />
          </button>
        )}
        {onToggleFullscreen && (
          <button onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className={`${BUTTON} ml-3`}>
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
        )}
      </div>
    </div>
  </div>
);
