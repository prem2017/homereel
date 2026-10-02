import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Film, Music, X } from 'lucide-react';
import { SearchResult, MediaType } from '../types';
import { searchFiles } from '../services/api';
import { normalizeKey } from '../utils/keys';
import { labelOf } from '../utils/mediaLabel';
import { folderOf } from '../utils/siblings';
import { highlight, queryWords } from '../utils/highlight';

// Drawing thousands of buttons for a one-letter query helps nobody; past this the
// list says to keep typing.
const SHOWN_AT_MOST = 50;

const isAudio = (result: SearchResult) => !!result.mimeType?.startsWith('audio');

const Marked: React.FC<{ text: string; words: string[] }> = ({ text, words }) => (
  <>
    {highlight(text, words).map((piece, i) => (piece.hit
      ? <span key={i} className="text-white font-semibold">{piece.text}</span>
      : <React.Fragment key={i}>{piece.text}</React.Fragment>))}
  </>
);

/**
 * The header's search: every word of the query, accents and punctuation ignored
 * (the server's rule), results grouped by folder with the words marked.
 *
 * Driven by keys as well as the pointer: Down from the box moves into the
 * results, Up and Down step through them, Enter plays, Escape or a click past it
 * closes it. Arrow presses stop here, as they do in the library, so they do not
 * also seek the film. The All / Video / Audio filter sits at the top of the
 * results with a count each, which is what frees the header on a phone - one
 * search answers all three, so switching costs no request.
 */
export const SearchBox: React.FC<{ onSelect: (result: SearchResult) => void }> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<MediaType>(MediaType.ALL);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (query.trim().length > 1) {
        setIsLoading(true);
        try {
          setResults(await searchFiles(query, MediaType.ALL));
          setSearchError(null);
        } catch (err) {
          setResults([]);
          setSearchError((err as Error).message);
        } finally {
          setIsLoading(false);
          setShowResults(true);
        }
      } else {
        setResults([]);
        setSearchError(null);
        setShowResults(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  // The dropdown used to have exactly two ways out: pick something, or empty the
  // box. Anything else left it hanging over the app. Both of these leave the
  // query alone - it is only the list that is being dismissed.
  useEffect(() => {
    if (!showResults) return;

    const onClickAway = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setShowResults(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (normalizeKey(e) === 'Escape') setShowResults(false);
    };

    document.addEventListener('click', onClickAway);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('click', onClickAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, [showResults]);

  const counts = useMemo(() => {
    const audio = results.filter(isAudio).length;
    return { all: results.length, video: results.length - audio, audio };
  }, [results]);
  const matching = useMemo(() => results.filter(r => searchType === MediaType.ALL
    || (searchType === MediaType.AUDIO ? isAudio(r) : !isAudio(r))), [results, searchType]);
  const shown = matching.slice(0, SHOWN_AT_MOST);
  const words = useMemo(() => queryWords(query), [query]);

  // Consecutive results from one folder under one heading; the server lists
  // them in library order, so a folder's results arrive together.
  const groups = useMemo(() => {
    const out: Array<{ folder: string; items: SearchResult[] }> = [];
    for (const result of shown) {
      const folder = folderOf(result.path).replace(/\/$/, '');
      const last = out[out.length - 1];
      if (last && last.folder === folder) last.items.push(result);
      else out.push({ folder, items: [result] });
    }
    return out;
  }, [shown]);

  const handleSelect = (result: SearchResult) => {
    onSelect(result);
    setQuery('');
    setShowResults(false);
  };

  const resultButtons = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-result]') || []);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (normalizeKey(e.nativeEvent) !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    if (!showResults && results.length > 0) setShowResults(true);
    window.setTimeout(() => resultButtons()[0]?.focus(), 0);
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const key = normalizeKey(e.nativeEvent);
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = resultButtons();
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (key === 'ArrowDown') buttons[Math.min(at + 1, buttons.length - 1)]?.focus();
    else if (at <= 0) inputRef.current?.focus();
    else buttons[at - 1]?.focus();
  };

  const filters: Array<[MediaType, string, number, string]> = [
    [MediaType.ALL, 'All', counts.all, 'bg-gray-700 text-white'],
    [MediaType.VIDEO, 'Video', counts.video, 'bg-blue-900 text-blue-200'],
    [MediaType.AUDIO, 'Audio', counts.audio, 'bg-purple-900 text-purple-200'],
  ];

  return (
    <div ref={searchRef} className="relative flex-1 max-w-xl ml-2 md:mx-auto min-w-0">
      <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 focus-within:border-blue-500 transition-colors">
        <Search size={18} className="ml-3 flex-none text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          className="bg-transparent border-none text-white text-sm w-full min-w-0 py-2 px-3 focus:outline-none placeholder-gray-500"
          placeholder="Search media..."
          aria-label="Search media"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setShowResults(true); }}
          onKeyDown={onInputKey}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); }}
            aria-label="Clear search"
            title="Clear search"
            className="mr-2 flex-none rounded text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 focus:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="flex items-center px-2 py-2 border-b border-gray-700">
            {filters.map(([type, name, count, on]) => (
              <button
                key={type}
                type="button"
                onClick={() => setSearchType(type)}
                aria-pressed={searchType === type}
                className={`mr-1 px-3 py-1 text-xs rounded-md transition-colors focus:outline-none focus:bg-blue-700 focus:text-white ${searchType === type ? on : 'text-gray-400 hover:text-gray-200'}`}
              >
                {name} <span className="opacity-70">{count}</span>
              </button>
            ))}
            <span className="ml-auto hidden md:inline text-xs text-gray-500">Arrow keys to move · Enter to play</span>
          </div>

          <div ref={listRef} className="max-h-80 overflow-y-auto" onKeyDown={onListKey}>
            {isLoading ? (
              <div className="p-4 text-center text-gray-400 text-sm">Searching...</div>
            ) : searchError ? (
              <div className="p-4 text-center text-red-300 text-sm">Search failed: {searchError}</div>
            ) : groups.length > 0 ? (
              groups.map(group => (
                <div key={group.folder || '/'}>
                  <div className="px-4 pt-2 pb-1 text-xs text-gray-500 truncate">
                    {group.folder ? group.folder.split('/').join(' › ') : 'Library'}
                  </div>
                  {group.items.map(result => {
                    const label = labelOf(result);
                    const name = label.series ? `${label.series} · ${label.title}` : label.title;
                    return (
                      // A real button so a TV remote can reach search results at
                      // all; focus: rather than focus-visible:, which needs Chrome 86.
                      <button
                        type="button"
                        key={result.path}
                        data-result=""
                        data-path={result.path}
                        data-kind={isAudio(result) ? 'audio' : 'video'}
                        title={result.path}
                        onClick={() => handleSelect(result)}
                        className="w-full text-left px-4 py-2 hover:bg-gray-700 focus:outline-none focus:bg-blue-700 cursor-pointer flex items-center text-sm text-gray-300"
                      >
                        {isAudio(result)
                          ? <Music size={14} className="flex-none mr-3 text-purple-400" />
                          : <Film size={14} className="flex-none mr-3 text-blue-400" />}
                        <span className="truncate min-w-0"><Marked text={name} words={words} /></span>
                        {(label.marker || label.year) && (
                          <span className="ml-auto pl-2 flex-none text-xs font-mono text-gray-500">{label.marker || label.year}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-gray-500 text-sm">No results found</div>
            )}
          </div>

          {!isLoading && !searchError && matching.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500">
              {matching.length > SHOWN_AT_MOST
                ? `Showing ${SHOWN_AT_MOST} of ${matching.length} - keep typing to narrow it`
                : `${matching.length} result${matching.length === 1 ? '' : 's'}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
