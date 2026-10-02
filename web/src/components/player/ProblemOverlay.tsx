import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { PlaybackProblem } from '../../utils/playbackError';

/**
 * A file that failed, said for that file, with each way on as a button - a bad
 * episode should not end the evening. Previously this was console-only, leaving
 * a black rectangle.
 */
export const ProblemOverlay: React.FC<{
  problem: { said: PlaybackProblem; code: number | null };
  fileName: string | null;
  filePath: string | null;
  onReveal?: (path: string) => void;
  onRetry: () => void;
  onNext?: () => void;
}> = ({ problem, fileName, filePath, onReveal, onRetry, onNext }) => (
  <div role="alert" className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 px-6 overflow-y-auto">
    <div className="max-w-lg text-center py-4">
      <AlertTriangle size={40} className="mx-auto mb-3 text-amber-400" />
      <p className="text-lg font-semibold text-white">{problem.said.title}</p>
      <p className="mt-2 text-sm text-gray-300">{problem.said.detail}</p>
      {problem.said.fix && <p className="mt-2 text-sm text-gray-300">{problem.said.fix}</p>}
      <div className="mt-4 flex flex-wrap justify-center">
        {onReveal && filePath && (
          <button
            type="button"
            onClick={() => onReveal(filePath)}
            className="m-1 text-sm px-4 py-2 rounded border border-gray-600 text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white"
          >
            Show in library
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="m-1 text-sm px-4 py-2 rounded border border-gray-600 text-gray-200 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white"
        >
          Try again
        </button>
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            className="m-1 text-sm px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500"
          >
            Play next
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-500 font-mono break-all">
        {fileName}{problem.code !== null && ` · browser error ${problem.code}`}
      </p>
    </div>
  </div>
);
