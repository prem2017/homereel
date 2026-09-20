import React, { useState, useEffect, useRef } from 'react';
import { Search, Film, Music, X, PanelLeft } from 'lucide-react';
import { SearchResult, MediaType } from '../types';
import { searchFiles } from '../services/api';
import { normalizeKey } from '../utils/keys';

interface HeaderProps {
  onSearchResultSelect: (result: SearchResult) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearchResultSelect, sidebarOpen, onToggleSidebar }) => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<MediaType>(MediaType.ALL);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (query.trim().length > 1) {
        setIsLoading(true);
        try {
          setResults(await searchFiles(query, searchType));
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
  }, [query, searchType]);

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

  const handleSelect = (result: SearchResult) => {
    onSearchResultSelect(result);
    setQuery('');
    setShowResults(false);
  };

  return (
    <header className="h-16 flex-none bg-gray-900 border-b border-gray-800 flex items-center justify-between px-3 md:px-6 z-50 shadow-md">
      <div className="flex items-center space-x-2 flex-none">
        {/* First in the DOM so a remote reaches it with one Tab - it is the only
            way back to the library once the sidebar is hidden. */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Hide file list' : 'Show file list'}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Hide file list' : 'Show file list'}
          className={`p-2 rounded-md focus:outline-none focus:bg-blue-700 focus:text-white hover:bg-gray-800 ${sidebarOpen ? 'text-gray-300' : 'text-blue-400'}`}
        >
          <PanelLeft size={18} />
        </button>

        {/* bg-blue-600 is the fallback: background-color paints only where the
            gradient (custom-property based) fails, i.e. on old TV browsers. */}
        <div className="w-8 h-8 bg-blue-600 bg-gradient-to-br from-blue-500 to-purple-600 rounded-md flex items-center justify-center">
             <Film className="text-white" size={18} />
        </div>
        <h1 className="hidden md:block text-xl font-bold bg-clip-text gradient-text bg-gradient-to-r from-blue-400 to-purple-400">
          MediaServer
        </h1>
      </div>

      <div ref={searchRef} className="relative flex-1 max-w-xl mx-2 md:mx-4">
        <div className="flex items-center bg-gray-800 rounded-lg border border-gray-700 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
          <Search size={18} className="ml-3 text-gray-400" />
          <input
            type="text"
            className="bg-transparent border-none text-white text-sm w-full py-2 px-3 focus:outline-none placeholder-gray-500"
            placeholder="Search media..."
            aria-label="Search media"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if(results.length > 0) setShowResults(true); }}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); }}
              aria-label="Clear search"
              title="Clear search"
              className="mr-2 rounded text-gray-400 hover:text-white focus:outline-none focus:bg-blue-700 focus:text-white"
            >
                <X size={14} />
            </button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {showResults && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden max-h-80 overflow-y-auto z-50">
             {isLoading ? (
                 <div className="p-4 text-center text-gray-400 text-sm">Searching...</div>
             ) : searchError ? (
                 <div className="p-4 text-center text-red-300 text-sm">Search failed: {searchError}</div>
             ) : results.length > 0 ? (
                results.map((res) => (
                    <button
                        type="button"
                        key={res.path}
                        onClick={() => handleSelect(res)}
                        // A real button so a TV remote can reach search results at all;
                        // focus: rather than focus-visible:, which needs Chrome 86.
                        className="w-full text-left px-4 py-2 hover:bg-gray-700 focus:outline-none focus:bg-blue-700 cursor-pointer flex items-center space-x-3 border-b border-gray-700/50 last:border-0"
                    >
                        {res.mimeType?.startsWith('audio') ? 
                            <Music size={14} className="text-purple-400" /> : 
                            <Film size={14} className="text-blue-400" />
                        }
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-sm text-gray-200 truncate">{res.name}</span>
                            <span className="text-xs text-gray-500 truncate">{res.path}</span>
                        </div>
                    </button>
                ))
             ) : (
                <div className="p-4 text-center text-gray-500 text-sm">No results found</div>
             )}
          </div>
        )}
      </div>

      <div className="flex items-center space-x-4 flex-none">
        {/* Type Filter Radio */}
        <div className="flex bg-gray-800 rounded-lg p-1">
            <button 
                type="button"
                onClick={() => setSearchType(MediaType.ALL)}
                aria-pressed={searchType === MediaType.ALL}
                className={`px-3 py-1 text-xs rounded-md transition-colors focus:outline-none focus:bg-blue-700 focus:text-white ${searchType === MediaType.ALL ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
            >
                All
            </button>
            <button 
                type="button"
                onClick={() => setSearchType(MediaType.VIDEO)}
                aria-pressed={searchType === MediaType.VIDEO}
                className={`px-3 py-1 text-xs rounded-md transition-colors focus:outline-none focus:bg-blue-700 focus:text-white ${searchType === MediaType.VIDEO ? 'bg-blue-900/50 text-blue-300 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
            >
                Video
            </button>
            <button 
                type="button"
                onClick={() => setSearchType(MediaType.AUDIO)}
                aria-pressed={searchType === MediaType.AUDIO}
                className={`px-3 py-1 text-xs rounded-md transition-colors focus:outline-none focus:bg-blue-700 focus:text-white ${searchType === MediaType.AUDIO ? 'bg-purple-900/50 text-purple-300 shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
            >
                Audio
            </button>
        </div>
      </div>
    </header>
  );
};