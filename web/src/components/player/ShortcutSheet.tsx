import React from 'react';
import { X } from 'lucide-react';
import { SHORTCUTS, GESTURES } from './usePlayerKeys';

/**
 * The shortcut sheet. Above everything, and closed by the backdrop, the X or
 * Escape - three ways out, because one of them has to be the one the thing in
 * your hand can do.
 */
export const ShortcutSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div
    className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-4"
    onClick={onClose}
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
          onClick={onClose}
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
);
