import React from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, RotateCcw, RotateCw, Gauge,
  ChevronLeft, ChevronRight, Keyboard,
} from 'lucide-react';
import { formatTime } from '../../utils/time';

interface ControlBarProps {
  /** Measured: the bottom subtitle is lifted clear of the bar. */
  barRef: React.RefObject<HTMLDivElement>;
  /** Written to directly during playback instead of through props - see the
   *  player's handleTimeUpdate. */
  progressRef: React.RefObject<HTMLInputElement>;
  timeLabelRef: React.RefObject<HTMLSpanElement>;
  bufferedRef: React.RefObject<HTMLDivElement>;
  visible: boolean;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playbackRate: number;
  isFullscreen: boolean;
  fileName: string | null;
  onPrevious?: () => void;
  onNext?: () => void;
  onSkip: (seconds: number) => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCycleRate: () => void;
  onShowHelp: () => void;
  onToggleFullscreen: () => void;
  onScrubStart: () => void;
  onScrubChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScrubCommit: (e: React.SyntheticEvent<HTMLInputElement>) => void;
}

/**
 * Seek bar and buttons along the foot of the picture.
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
  barRef, progressRef, timeLabelRef, bufferedRef, visible, duration, isPlaying, isMuted, volume,
  playbackRate, isFullscreen, fileName, onPrevious, onNext, onSkip, onTogglePlay, onToggleMute,
  onVolumeChange, onCycleRate, onShowHelp, onToggleFullscreen, onScrubStart, onScrubChange, onScrubCommit,
}) => (
  <div ref={barRef} className={`absolute bottom-0 left-0 right-0 bg-black/70 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 transition-opacity duration-300 z-40 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
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
          onMouseDown={onScrubStart}
          onTouchStart={onScrubStart}
          onChange={onScrubChange}
          onMouseUp={onScrubCommit}
          onTouchEnd={onScrubCommit}
          onBlur={onScrubCommit}
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
        <button onClick={() => onSkip(-10)} aria-label="Back 10 seconds" className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition flex flex-col items-center space-y-0.5 group">
          <RotateCcw size={20} />
          <span className="text-[10px] -mt-1 font-bold group-hover:text-blue-400">10</span>
        </button>
        <button onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition transform hover:scale-110 mx-2">
          {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
        </button>
        <button onClick={() => onSkip(10)} aria-label="Forward 10 seconds" className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition flex flex-col items-center space-y-0.5 group">
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
          <button onClick={onToggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded">
            {isMuted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
          <input
            type="range" min="0" max="1" step="0.05"
            value={isMuted ? 0 : volume} onChange={onVolumeChange}
            aria-label="Volume"
            className="w-0 overflow-hidden group-hover/volume:w-24 focus:w-24 transition-all h-1 bg-gray-500 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        {/* Speed Control */}
        <button onClick={onCycleRate} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded ml-4 flex items-center space-x-1 min-w-[3rem]" title="Playback Speed">
          <Gauge size={20} />
          <span className="text-xs font-bold">{playbackRate}x</span>
        </button>
        <div className="text-white ml-4 truncate max-w-[150px] text-sm font-medium opacity-80" title={fileName || ''}>{fileName}</div>
      </div>

      <div className="flex items-center space-x-4">
        {/* The only route to the shortcut list on a remote: "?" needs a
            Shift the TV browser cannot report. */}
        <button
          onClick={onShowHelp}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition"
        >
          <Keyboard size={22} />
        </button>
        <button onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="text-white hover:text-blue-400 focus:outline-none focus:bg-blue-700 rounded transition">
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
      </div>
    </div>
  </div>
);
