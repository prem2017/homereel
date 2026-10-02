import React from 'react';
import { Music } from 'lucide-react';
import { FileNode } from '../../types';
import { getStreamUrl } from '../../services/api';
import { foldersOf, labelOf } from '../../utils/mediaLabel';
import { formatTime } from '../../utils/time';

// The pictures a music folder carries, by the names players use.
const COVER = /^(cover|folder|front|album|poster)\.(jpe?g|png|webp)$/i;

/** The folder's cover, from the files beside the track, as a media path. */
export const coverIn = (siblings: FileNode[]): string | undefined => {
  const cover = siblings.find(node => node.type === 'file' && COVER.test(node.name));
  return cover ? cover.path : undefined;
};

/**
 * What a song shows instead of a pulsing speaker: the album's cover (or a
 * tile), the track's title without its number, the album from the folder, and
 * the folder's tracks - the one playing marked, lengths shown once known.
 * Picking a track plays it. The <audio> element and the controls are the
 * player's own, unchanged.
 */
export const NowPlaying: React.FC<{
  file: FileNode;
  tracks: FileNode[];
  cover?: string;
  /** Lengths learned so far, by path; the playing one from the element. */
  lengths: Map<string, number>;
  /** Room left at the foot for the control bar. */
  compact: boolean;
  onPlayFile?: (node: FileNode) => void;
}> = ({ file, tracks, cover, lengths, compact, onPlayFile }) => {
  const label = labelOf(file);
  const folders = foldersOf(file.path);
  const album = folders.length > 0 ? folders[folders.length - 1] : null;
  const at = tracks.findIndex(t => t.path === file.path);

  return (
    <div className={`absolute inset-0 z-0 flex bg-gray-900 ${compact ? 'items-center px-4 pb-16' : 'pb-24'}`}>
      <div className={`flex items-center min-w-0 ${compact ? 'flex-1' : 'flex-1 px-8'}`}>
        {cover ? (
          <img src={getStreamUrl(cover)} alt="" className={`flex-none rounded-lg object-cover bg-gray-800 shadow-2xl ${compact ? 'w-20 h-20' : 'w-40 h-40 lg:w-56 lg:h-56'}`} />
        ) : (
          <span className={`flex-none flex items-center justify-center rounded-lg bg-indigo-900 shadow-2xl ${compact ? 'w-20 h-20' : 'w-40 h-40 lg:w-56 lg:h-56'}`}>
            <Music size={compact ? 32 : 64} className="text-indigo-300" />
          </span>
        )}
        <div className={`min-w-0 ${compact ? 'ml-4' : 'ml-8'}`}>
          {album && <p className="text-xs uppercase tracking-wider text-gray-400 truncate">{album}</p>}
          <p className={`font-semibold text-white break-words line-clamp-2 ${compact ? 'text-lg' : 'text-2xl lg:text-3xl'}`}>{label.title}</p>
          {at >= 0 && tracks.length > 1 && (
            <p className="mt-1 text-sm text-gray-400">Track {at + 1} of {tracks.length}</p>
          )}
        </div>
      </div>

      {/* The folder's tracks. On a phone the list below the film has them. */}
      {!compact && tracks.length > 1 && (
        <ol className="w-80 max-w-[45%] flex-none overflow-y-auto py-6 pr-6">
          {tracks.map((track, i) => {
            const playing = track.path === file.path;
            const length = lengths.get(track.path);
            return (
              <li key={track.path}>
                <button
                  type="button"
                  onClick={() => { if (!playing) onPlayFile?.(track); }}
                  aria-current={playing ? 'true' : undefined}
                  title={track.name}
                  className={`w-full flex items-center px-3 py-2 rounded-md text-left text-sm focus:outline-none focus:bg-blue-700 focus:text-white ${playing ? 'bg-gray-800 text-blue-300' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  <span className="w-6 flex-none font-mono text-xs text-gray-500">{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate min-w-0">{labelOf(track).title}</span>
                  <span className="ml-auto pl-3 flex-none font-mono text-xs text-gray-500">
                    {length !== undefined ? formatTime(length) : '–:––'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
