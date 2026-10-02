import React from 'react';
import { FileNode } from '../../types';
import { foldersOf, labelOf } from '../../utils/mediaLabel';
import { languageName, languageOfSubtitle } from '../../utils/subtitleLabel';

const SOURCES: Record<string, string> = {
  bluray: 'BluRay', 'web-dl': 'WEB-DL', webrip: 'WEBRip', hdtv: 'HDTV', dvdrip: 'DVDRip',
  bdrip: 'BDRip', brrip: 'BRRip', hdrip: 'HDRip', dvd: 'DVD',
};

/** "5.6 MB", "1.4 GB". */
export const formatSize = (bytes: number): string => {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1024; unit++; }
  return unit === 0 ? `${bytes} bytes` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const nameOf = (subtitle: FileNode | null) => {
  if (!subtitle) return null;
  const code = languageOfSubtitle(subtitle.name);
  return code ? languageName(code) : 'Subtitles';
};

/**
 * The line under the player: where the file is (pressing it opens the library
 * there), what it is, and which subtitles are showing where. It replaces the
 * file name said three times over - in the control bar, here, and as a path.
 * The full path stays as the tooltip.
 */
export const InfoLine: React.FC<{
  file: FileNode;
  top: FileNode | null;
  bottom: FileNode | null;
  onReveal?: (path: string) => void;
}> = ({ file, top, bottom, onReveal }) => {
  const label = labelOf(file);
  const info = file.info;
  const folders = foldersOf(file.path);
  const title = label.series ? `${label.series} · ${label.title}` : label.title;
  const facts = [
    label.marker,
    label.track !== undefined ? `Track ${label.track}` : null,
    info?.year && !label.marker ? String(info.year) : null,
    info?.resolution,
    info?.source ? (SOURCES[info.source] || info.source.toUpperCase()) : null,
    label.risk,
    file.size ? formatSize(file.size) : null,
  ].filter(Boolean);
  const showing = [
    bottom ? `${nameOf(bottom)} at the bottom` : null,
    top ? `${nameOf(top)} on top` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex-none mt-3 px-3 py-2 bg-gray-800/50 rounded-lg flex items-center">
      <div className="min-w-0 flex-1">
        {folders.length > 0 && (
          <button
            type="button"
            onClick={() => onReveal?.(file.path)}
            title={`${file.path} — show in library`}
            className="block max-w-full text-left text-xs text-gray-400 hover:text-white truncate focus:outline-none focus:bg-blue-700 focus:text-white rounded"
          >
            {folders.join(' › ')}
          </button>
        )}
        <h2 className="text-base font-medium text-white truncate" title={file.name}>{title}</h2>
        {facts.length > 0 && <p className="text-xs text-gray-400 truncate">{facts.join(' · ')}</p>}
      </div>
      {!file.mimeType?.startsWith('audio/') && (
        <p className="hidden sm:block flex-none ml-4 text-xs text-gray-400 text-right">{showing || 'No subtitles'}</p>
      )}
    </div>
  );
};
