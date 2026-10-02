import React, { useState } from 'react';
import { Film, PanelLeft } from 'lucide-react';
import { SearchResult } from '../types';
import { SearchBox } from './SearchBox';
import { cycleTextScale, readTextScale } from '../utils/textScale';

interface HeaderProps {
  onSearchResultSelect: (result: SearchResult) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Close whatever is playing and show Home. */
  onHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearchResultSelect, sidebarOpen, onToggleSidebar, onHome }) => {
  const [textScale, setTextScale] = useState(readTextScale);
  return (
  <header className="h-16 flex-none bg-gray-900 border-b border-gray-800 flex items-center px-3 md:px-6 z-50 shadow-md">
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

      {/* The name is the way Home: Home is where Continue watching lives now.
          bg-blue-600 is the fallback: background-color paints only where the
          gradient (custom-property based) fails, i.e. on old TV browsers. */}
      <h1 className="flex-none">
        <button
          type="button"
          onClick={onHome}
          aria-label="Home"
          title="Home"
          className="flex items-center space-x-2 rounded-md px-1 py-1 hover:bg-gray-800 focus:outline-none focus:bg-blue-700"
        >
          <span className="w-8 h-8 bg-blue-600 bg-gradient-to-br from-blue-500 to-purple-600 rounded-md flex items-center justify-center">
            <Film className="text-white" size={18} />
          </span>
          <span className="hidden md:block text-xl font-bold bg-clip-text gradient-text bg-gradient-to-r from-blue-400 to-purple-400">
            HomeReel
          </span>
        </button>
      </h1>
    </div>

    {/* The whole rest of the header: the All / Video / Audio filter moved into
        the results, which is what gives search room on a phone. */}
    <SearchBox onSelect={onSearchResultSelect} />

    {/* Text size for this screen: 100, 125, 150%. Not on a phone, which has
        its own zoom and no room. */}
    <button
      type="button"
      onClick={() => setTextScale(cycleTextScale(textScale))}
      aria-label={`Text size ${Math.round(textScale * 100)}%`}
      title="Text size for this screen"
      className="hidden md:flex flex-none items-baseline ml-2 px-2 py-1 rounded-md text-gray-300 hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white"
    >
      <span className="font-serif text-lg leading-none">Aa</span>
      <span className="ml-1 text-xs text-gray-400">{Math.round(textScale * 100)}%</span>
    </button>
  </header>
  );
};
