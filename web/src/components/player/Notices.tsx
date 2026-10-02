import React from 'react';
import { X } from 'lucide-react';
import { formatTime } from '../../utils/time';

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
 * What plays next, and when. Always visible while it counts, controls hidden or
 * not - it is the one notice with a deadline. `noticeRef` is measured so the
 * bottom subtitle clears it.
 */
export const UpNextNotice: React.FC<{
  noticeRef: React.RefObject<HTMLDivElement>;
  seconds: number;
  nextName: string | null | undefined;
  onPlayNow: () => void;
  onStay: () => void;
}> = ({ noticeRef, seconds, nextName, onPlayNow, onStay }) => (
  <div ref={noticeRef} className="absolute bottom-24 left-0 right-0 z-40 flex justify-center px-4">
    <div className="flex items-center space-x-3 bg-gray-900/95 border border-gray-700 rounded-full pl-4 pr-2 py-2 max-w-full">
      <span className="text-sm text-gray-200 truncate">
        Up next in {seconds}s · <span className="text-white">{nextName}</span>
      </span>
      <button
        onClick={onPlayNow}
        className="flex-none text-xs font-semibold text-blue-300 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
      >
        Play now
      </button>
      <button
        onClick={onStay}
        className="flex-none text-xs text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 rounded-full px-3 py-1"
      >
        Stay here
      </button>
    </div>
  </div>
);
