import React from 'react';
import { X } from 'lucide-react';
import { formatTime } from '../../utils/time';
import { FileNode } from '../../types';
import { foldersOf, fullTitleOf, labelOf, seasonOf } from '../../utils/mediaLabel';

/**
 * Resumed from a saved position, with the way back to the start.
 *
 * Centred by a full-width flex row rather than by -translate-x-1/2: Tailwind
 * builds every transform out of custom properties, which Chromium 47 does not
 * have, so on the TV this notice used to start at the middle of the screen and
 * run off the right-hand edge. It fades with the controls; `noticeRef` is
 * measured so the bottom subtitle clears it.
 */
export const ResumeNotice: React.FC<{
  noticeRef: React.RefObject<HTMLDivElement>;
  visible: boolean;
  resumedFrom: number;
  onStartOver: () => void;
  onDismiss: () => void;
}> = ({ noticeRef, visible, resumedFrom, onStartOver, onDismiss }) => (
  <div ref={noticeRef} className={`absolute bottom-24 left-0 right-0 z-40 flex justify-center px-4 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
    <div className="flex items-center space-x-3 bg-gray-900/95 border border-gray-700 rounded-full pl-4 pr-2 py-2">
      <span className="text-sm text-gray-200">Resumed from {formatTime(resumedFrom)}</span>
      <button
        onClick={onStartOver}
        className="text-xs font-semibold text-blue-300 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
      >
        Start over
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full p-1"
      >
        <X size={14} />
      </button>
    </div>
  </div>
);

/**
 * What plays next, and when: a card in the bottom-right corner, readable from a
 * sofa - the episode, its show and season, in 16-24px text. It was a 14px pill
 * carrying the raw file name, the one notice with a deadline and the hardest to
 * read at a distance.
 *
 * Always visible while it counts, controls hidden or not. Play now carries the
 * seconds left and its fill drains as they pass - a width, not a transform
 * (Chromium 47). `noticeRef` is measured so the bottom subtitle clears it.
 */
export const UpNextNotice: React.FC<{
  noticeRef: React.RefObject<HTMLDivElement>;
  seconds: number;
  total: number;
  next: FileNode;
  current: FileNode | null;
  onPlayNow: () => void;
  onStay: () => void;
}> = ({ noticeRef, seconds, total, next, current, onPlayNow, onStay }) => {
  const label = labelOf(next);
  const episode = next.info?.episode !== undefined;
  const newSeason = episode && current?.info?.season !== undefined && next.info?.season !== undefined
    && next.info.season !== current.info.season;
  const folders = foldersOf(next.path);
  const season = folders.length > 0 && seasonOf(folders[folders.length - 1]) !== null ? folders[folders.length - 1] : null;
  const heading = newSeason ? 'Next season' : episode ? 'Next episode' : 'Next in this folder';
  const context = episode ? [label.series, season || (next.info?.season !== undefined ? `Season ${next.info.season}` : null)].filter(Boolean).join(' · ') : null;

  return (
    <div ref={noticeRef} className="absolute bottom-24 right-3 sm:right-4 z-40 w-80 max-w-[90%] bg-gray-900/95 border border-gray-700 rounded-lg p-4 shadow-2xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{heading}</p>
      <p className="mt-1 flex items-baseline min-w-0">
        <span className="text-xl font-semibold text-white truncate">{episode ? label.title : fullTitleOf(next)}</span>
        {label.marker && <span className="ml-2 flex-none text-sm font-mono text-gray-400">{label.marker}</span>}
      </p>
      {context && <p className="text-sm text-gray-400 truncate">{context}</p>}
      <div className="mt-3 flex">
        <button
          type="button"
          onClick={onPlayNow}
          className="relative flex-1 overflow-hidden rounded bg-blue-800 text-white text-base font-semibold py-2 focus:outline-none focus:bg-blue-600"
        >
          <span
            className="absolute inset-y-0 left-0 bg-blue-600"
            style={{ width: `${Math.max(0, Math.min(1, seconds / total)) * 100}%`, transition: 'width 1s linear' }}
          />
          <span className="relative">Play now · {seconds}</span>
        </button>
        <button
          type="button"
          onClick={onStay}
          className="ml-2 px-4 rounded border border-gray-600 text-base text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700"
        >
          Stay here
        </button>
      </div>
    </div>
  );
};
