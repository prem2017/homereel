import React, { useMemo } from 'react';
import { AlertTriangle, Folder, Loader2, Music, Film } from 'lucide-react';
import { FileNode } from '../types';
import { getStreamUrl } from '../services/api';
import { BrowseTile, HomeCard, browseTiles, continueCards, folderArt, recentlyAddedCards } from '../utils/home';

interface HomeProps {
  tree: FileNode[];
  filesByPath: Map<string, FileNode>;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  /** The stores the player writes, as App last read them. */
  positions: Array<[string, number]>;
  durations: Map<string, number>;
  watched: Map<string, number>;
  onPlay: (node: FileNode) => void;
  /** Open the library at a folder. */
  onBrowse: (folder: FileNode) => void;
}

// Enough for a couple of series on the go and a week of arrivals, on one TV screen.
const CONTINUE_LIMIT = 8;
const RECENT_LIMIT = 8;

// A tile's colour when the folder has no picture: picked from the title, so the
// same film keeps the same colour. Hex, never a custom property (Chromium 47).
const TILE_COLOURS = ['#1e3a8a', '#4c1d95', '#831843', '#7c2d12', '#14532d', '#134e4a', '#3730a3', '#713f12'];
const colourFor = (text: string) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 9973;
  return TILE_COLOURS[hash % TILE_COLOURS.length];
};

/** The folder's poster, or a coloured tile with the title on it. */
const Art: React.FC<{ art?: string; title: string; audio?: boolean }> = ({ art, title, audio }) => (
  art ? (
    <img src={getStreamUrl(art)} alt="" className="block w-full h-28 object-cover bg-gray-900" />
  ) : (
    <span
      className="flex items-center justify-center w-full h-28 px-3 text-center text-base font-semibold text-white overflow-hidden"
      style={{ backgroundColor: colourFor(title) }}
    >
      {audio ? <Music size={32} className="text-white opacity-60" /> : title}
    </span>
  )
);

// A real button, like every file row, so a remote can reach it. A solid border
// rather than a ring: rings are custom-property based and vanish on the TV.
// Two across on a phone, a fixed width from there up.
const CARD = 'w-[calc(50%-1rem)] sm:w-48 m-2 flex-none text-left rounded-lg overflow-hidden bg-gray-800 border-2 border-transparent hover:border-gray-500 focus:outline-none focus:border-blue-500 transition-colors';

const Card: React.FC<{ card: HomeCard; onPlay: (node: FileNode) => void }> = ({ card, onPlay }) => (
  <button type="button" className={CARD} onClick={() => onPlay(card.node)} title={`${card.node.name} — ${card.detail}`}>
    <Art art={card.art} title={card.title} audio={card.node.mimeType?.startsWith('audio/')} />
    {/* Two lines, always the room for two, so a show's name and its episode fit
        and every card in a row is the same height. */}
    <span className="block px-3 pt-2 h-12 text-sm leading-5 font-medium text-white break-words line-clamp-2">{card.title}</span>
    <span className="block px-3 pb-2 text-xs text-gray-400 truncate">{card.detail}</span>
    {card.fraction > 0 && (
      <span className="block h-1 bg-gray-700">
        <span className="block h-full bg-blue-500" style={{ width: `${Math.round(card.fraction * 100)}%` }} />
      </span>
    )}
  </button>
);

const Tile: React.FC<{ tile: BrowseTile; onBrowse: (folder: FileNode) => void }> = ({ tile, onBrowse }) => (
  <button
    type="button"
    className={`${CARD} flex items-center px-3 py-3`}
    onClick={() => onBrowse(tile.folder)}
    title={`Open ${tile.folder.name} in the library`}
  >
    {tile.art
      ? <img src={getStreamUrl(tile.art)} alt="" className="flex-none w-10 h-10 rounded object-cover mr-3" />
      : <Folder size={28} className="flex-none text-yellow-500 mr-3" />}
    <span className="min-w-0">
      <span className="block text-sm font-medium text-white truncate">{tile.folder.name}</span>
      <span className="block text-xs text-gray-400 truncate">{tile.detail}</span>
    </span>
  </button>
);

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="mb-6">
    <div className="flex items-baseline px-2 mb-1">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h2>
      {note && <span className="ml-3 text-xs text-gray-500">{note}</span>}
    </div>
    <div className="flex flex-wrap">{children}</div>
  </section>
);

/**
 * What the main area shows while nothing plays: where you were, what is next,
 * what arrived, and the top of the library - instead of a black box saying
 * "Select media to play", which is the first thing the TV showed.
 *
 * Loading, failed and empty are states of their own, as in the library: a slow
 * first scan must not read as an empty folder.
 */
export const Home: React.FC<HomeProps> = ({
  tree, filesByPath, loading, loadError, onRetry, positions, durations, watched, onPlay, onBrowse,
}) => {
  const art = useMemo(() => folderArt(tree), [tree]);
  const going = useMemo(
    () => continueCards(tree, filesByPath, positions, durations, watched, art, CONTINUE_LIMIT),
    [tree, filesByPath, positions, durations, watched, art],
  );
  const recent = useMemo(() => recentlyAddedCards(tree, watched, art, RECENT_LIMIT, Date.now()), [tree, watched, art]);
  const tiles = useMemo(() => browseTiles(tree), [tree]);

  if (loading && tree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-black rounded-lg text-gray-400">
        <Loader2 size={24} className="animate-spin mr-3" />
        <span className="text-lg">Loading your library…</span>
      </div>
    );
  }

  // Said here too, not only in the sidebar - a phone hides the sidebar, and a
  // blank screen over a library that cannot be read sends people looking for
  // files the server cannot see.
  if (loadError && tree.length === 0) {
    return (
      <div data-home="" role="alert" className="flex items-center justify-center h-full bg-black rounded-lg px-6 py-6 overflow-y-auto">
        <div className="max-w-lg text-center">
          <AlertTriangle size={40} className="mx-auto mb-3 text-amber-400" />
          <p className="text-lg font-semibold text-white">HomeReel can't load your library</p>
          <p className="mt-2 text-sm text-gray-300 break-words">{loadError}</p>
          <p className="mt-2 text-sm text-gray-400">
            Check that <code className="text-gray-200">MEDIA_DIR</code> in your{' '}
            <code className="text-gray-200">.env</code> points at a folder that exists, then restart the server.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 text-sm px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:bg-blue-500"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (tiles.length === 0 && recent.length === 0) {
    return (
      <div data-home="" className="flex items-center justify-center h-full bg-black rounded-lg px-6 text-center">
        <div className="max-w-md">
          <Film size={40} className="mx-auto mb-3 text-gray-600" />
          <p className="text-lg text-gray-300">No video or audio files in your media folder yet</p>
          <p className="mt-2 text-sm text-gray-500">Add some to the folder <code>MEDIA_DIR</code> points at, then press Rescan in the library.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-home="" className="h-full overflow-y-auto rounded-lg bg-black px-2 md:px-4 py-4">
      {going.length > 0 && (
        <Section title="Continue watching" note={`${going.length} to pick up`}>
          {going.map(card => <Card key={card.node.path} card={card} onPlay={onPlay} />)}
        </Section>
      )}
      {recent.length > 0 && (
        <Section title="Recently added">
          {recent.map(card => <Card key={card.node.path} card={card} onPlay={onPlay} />)}
        </Section>
      )}
      {tiles.length > 0 && (
        <Section title="Browse">
          {tiles.map(tile => <Tile key={tile.folder.path} tile={tile} onBrowse={onBrowse} />)}
        </Section>
      )}
    </div>
  );
};
