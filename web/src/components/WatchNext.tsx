import React from 'react';
import { Film, Music } from 'lucide-react';
import { FileNode } from '../types';
import { HomeCard } from '../utils/home';
import { foldersOf, labelOf } from '../utils/mediaLabel';

const ROW = 'w-full flex items-center px-3 py-2 text-left rounded-lg hover:bg-gray-800 focus:outline-none focus:bg-blue-700';

const Icon: React.FC<{ node: FileNode }> = ({ node }) => (node.mimeType?.startsWith('audio/')
  ? <Music size={16} className="flex-none mr-3 text-purple-400" />
  : <Film size={16} className="flex-none mr-3 text-blue-400" />);

/**
 * Below the film on a phone, where the sidebar is a drawer: what Next would play
 * after this one (the same list - into the next season too), then Continue
 * watching. Real buttons, like every other row.
 */
export const WatchNext: React.FC<{
  upcoming: FileNode[];
  going: HomeCard[];
  onPlay: (node: FileNode) => void;
}> = ({ upcoming, going, onPlay }) => {
  if (upcoming.length === 0 && going.length === 0) return null;
  const first = upcoming[0];
  const where = first ? (labelOf(first).series || foldersOf(first.path).slice(-1)[0] || 'this folder') : '';

  return (
    <div className="mt-4">
      {upcoming.length > 0 && (
        <section className="mb-4">
          <h2 className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Next in {where}</h2>
          {upcoming.map(node => {
            const label = labelOf(node);
            return (
              <button key={node.path} type="button" className={ROW} onClick={() => onPlay(node)} title={node.name}>
                <Icon node={node} />
                <span className="truncate min-w-0 text-sm text-gray-200">{label.title}</span>
                {label.marker && <span className="ml-auto pl-2 flex-none text-xs font-mono text-gray-500">{label.marker}</span>}
              </button>
            );
          })}
        </section>
      )}
      {going.length > 0 && (
        <section>
          <h2 className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Continue watching</h2>
          {going.map(card => (
            <button key={card.node.path} type="button" className={`${ROW} relative`} onClick={() => onPlay(card.node)} title={`${card.node.name} — ${card.detail}`}>
              <Icon node={card.node} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-200">{card.title}</span>
                <span className="block truncate text-xs text-gray-500">{card.detail}</span>
              </span>
              {card.fraction > 0 && (
                <span className="absolute left-3 right-3 bottom-0 h-0.5 bg-gray-700">
                  <span className="block h-full bg-blue-500" style={{ width: `${Math.round(card.fraction * 100)}%` }} />
                </span>
              )}
            </button>
          ))}
        </section>
      )}
    </div>
  );
};
