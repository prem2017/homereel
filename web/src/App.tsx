import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Header } from './components/Header';
import { FileTree, rowDomId } from './components/FileTree';
import { MediaPlayer } from './components/MediaPlayer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { fetchFileTree } from './services/api';
import { FileNode, SearchResult } from './types';
import { readPref, writePref, PREF } from './utils/prefs';
import { indexFiles, readProgress, recentlyPlayed } from './utils/resume';
import { findSiblings, folderOf, isPlayable } from './utils/siblings';
import { formatTime } from './utils/time';

// Below this the sidebar stops being furniture and becomes a drawer. A phone on
// the same Wi-Fi is the second most likely client after the TV, and a fixed
// 250px column on a 360px screen leaves nothing for the film.
const NARROW_WIDTH = 768;

// How many files to offer picking up again. Enough for a couple of series on the
// go without pushing the library itself off the screen.
const CONTINUE_WATCHING = 4;

function App() {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<FileNode | null>(null);

  // Subtitles written to disk since this page loaded - one Subscene id is often
  // a whole season, so a single press can write one for every episode in a
  // folder. The file tree was fetched once at mount and the scan behind it is
  // whole-library and synchronous, so refetching it mid-playback to pick up ten
  // small files would be the expensive way to learn something already known.
  const [savedSubtitles, setSavedSubtitles] = useState<FileNode[]>([]);

  const handleSubtitlesSaved = useCallback((nodes: FileNode[]) => {
    setSavedSubtitles(prev => {
      const known = new Set(prev.map(n => n.path));
      const fresh = nodes.filter(n => !known.has(n.path));
      // The same array back when there is nothing new. A fresh one would be a
      // fresh `siblings` identity for the player, rerunning everything keyed on
      // it to reach the list it already had.
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Resizable Sidebar State
  // Remembered between visits; ~13% of the window, minimum 200px, the first time.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const fallback = typeof window !== 'undefined'
      ? Math.max(200, window.innerWidth * 0.13)
      : 250;
    return readPref(PREF.sidebarWidth, fallback);
  });

  // On a phone the sidebar is a drawer over the player rather than a column
  // beside it, so it starts closed there whatever was last chosen on a desktop -
  // an overlay is a transient thing and restoring one over the film would be a
  // strange way to open the app.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_WIDTH,
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < NARROW_WIDTH;
    return narrow ? false : readPref(PREF.sidebarOpen, 1) === 1;
  });

  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Crossing the threshold changes what the sidebar *is*, so it reverts to the
  // right default for the new shape: closed as a drawer, and back to the last
  // deliberate desktop choice as a column. Without this, dismissing the drawer on
  // a phone and then turning it sideways left the column hidden with no hint why.
  useEffect(() => {
    setSidebarOpen(isNarrow ? false : readPref(PREF.sidebarOpen, 1) === 1);
  }, [isNarrow]);

  // Written here rather than in an effect on `sidebarOpen`, because only this is
  // the user saying so: the drawer also closes when it is tapped past or a file
  // is picked, and neither of those is a decision about the desktop layout.
  const toggleSidebar = useCallback(() => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    // Outside the updater: React may run one of those twice, which is no place
    // for a write.
    if (!isNarrow) writePref(PREF.sidebarOpen, next ? 1 : 0);
  }, [sidebarOpen, isNarrow]);

  // The library, read from the server. The scan is whole-library, so this runs
  // at load, when the rescan button is pressed, and when search turns up a file
  // the tree has never heard of - search reads the disk, the tree was read once.
  // Global error reporting is registered in main.tsx, before the first render.
  const loadLibrary = useCallback(() => {
    setLoading(true);
    return fetchFileTree().then(data => {
      setFileTree(data);
      setLoadError(null);
    }).catch((err: Error) => {
      console.error(err);
      setLoadError(err.message);
    }).then(() => setLoading(false));
  }, []);

  useEffect(() => { loadLibrary(); }, [loadLibrary]);

  // What is playing, in the tab title. Two of these open on a laptop were
  // otherwise indistinguishable.
  useEffect(() => {
    document.title = currentFile ? `${currentFile.name} · HomeReel` : 'HomeReel';
  }, [currentFile]);

  // useCallback is load-bearing, not decoration: this is passed to every row in the
  // file tree, and React.memo there is inert if the prop changes identity each render.
  const handleSelectFile = useCallback((file: FileNode) => {
    setCurrentFile(file);
    // A drawer that stayed open would be covering the film it was just used to
    // choose. On a desktop the sidebar is furniture and stays put.
    if (isNarrow) setSidebarOpen(false);
  }, [isNarrow]);

  // The current file's folder, from the tree as it stands - so a rescan that finds
  // a new subtitle or episode reaches the player's menus and Next straight away.
  const currentFileSiblings = useMemo(
    () => (currentFile ? findSiblings(fileTree, currentFile.path) : []),
    [fileTree, currentFile],
  );

  // How far into each file playback got. Re-read on a change of selection and
  // again whenever the player writes a position, which it does every few seconds
  // - so the film playing now is in this list, at the top, with a bar that moves.
  // Reading only on a change of file meant a newly started video was invisible
  // here until some *other* file was picked, which read as the list being broken.
  //
  // The cost of that is a re-render of App every five seconds during playback.
  // It is paid for by `React.memo` on the player and by the file rows, which
  // take a number rather than the map and so re-render only where it changed.
  const [watched, setWatched] = useState(() => readProgress());
  useEffect(() => { setWatched(readProgress()); }, [currentFile?.path]);
  const handleProgress = useCallback(() => setWatched(readProgress()), []);

  // Walking the whole tree is the expensive half of the line below, and it only
  // changes when the library does - not every time a position is written.
  const filesByPath = useMemo(() => indexFiles(fileTree), [fileTree]);

  const recent = useMemo(
    () => recentlyPlayed(filesByPath, watched.positions, watched.durations, CONTINUE_WATCHING, currentFile?.path || null),
    [filesByPath, watched, currentFile],
  );

  // Folder-scoped, because that is what a download's landing place means: a
  // subtitle saved into another folder is not this video's business.
  const siblingsWithSaved = useMemo(() => {
    if (!currentFile || savedSubtitles.length === 0) return currentFileSiblings;

    const here = folderOf(currentFile.path);
    const known = new Set(currentFileSiblings.map(n => n.path));
    const extra = savedSubtitles.filter(n => folderOf(n.path) === here && !known.has(n.path));

    return extra.length > 0 ? [...currentFileSiblings, ...extra] : currentFileSiblings;
  }, [currentFile, currentFileSiblings, savedSubtitles]);

  const handleSearchResultSelect = (result: SearchResult) => {
    const fileNode: FileNode = {
      name: result.name,
      path: result.path,
      type: 'file',
      mimeType: result.mimeType
    };
    handleSelectFile(fileNode);

    const reveal = () => setTimeout(() => {
      document.getElementById(rowDomId(result.path))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);

    // A hit the tree does not hold was added since the page loaded. Without a
    // rescan it has no row to reveal and no folder to find subtitles or a next
    // episode in.
    if (filesByPath.has(result.path)) reveal();
    else loadLibrary().then(reveal);
  };

  // The playable neighbours of the current file, in folder order. Tested the way
  // the library tests what it lists, so Next steps through exactly the files the
  // sidebar showed: the alternative was excluding subtitles by extension and
  // calling everything else playable, which put the `.nfo` and the
  // "Torrent Downloaded From ....txt" that ship with a release folder into the
  // rotation - reachable by Next and by nothing else, since the library hides
  // them. Subtitles fail it too, which is right: they sit alongside the media
  // they belong to and are not stops in their own right.
  const playableSiblings = useMemo(
    () => currentFileSiblings.filter(isPlayable),
    [currentFileSiblings]
  );

  const currentIndex = currentFile
    ? playableSiblings.findIndex(f => f.path === currentFile.path)
    : -1;

  // Named, not just counted: the player announces what is coming before it goes
  // there, so the jump at the end of an episode can be stopped.
  const nextFile = currentIndex >= 0 ? playableSiblings[currentIndex + 1] : undefined;

  // Autoplay-on-ended and the player's next/previous buttons are the same operation.
  const playOffset = useCallback((offset: number) => {
    const target = currentIndex >= 0 ? playableSiblings[currentIndex + offset] : undefined;
    if (target) handleSelectFile(target);
  }, [currentIndex, playableSiblings, handleSelectFile]);

  const handleMediaEnded = useCallback(() => playOffset(1), [playOffset]);

  // Stable identities, so React.memo on the player is not inert. Written inline
  // these were a fresh function on every render of App - which now happens every
  // few seconds while a film plays.
  const handleNext = useCallback(() => playOffset(1), [playOffset]);
  const handlePrevious = useCallback(() => playOffset(-1), [playOffset]);

  // Resizing Logic
  const startResizing = (e: React.MouseEvent | React.TouchEvent) => {
    // Prevent default to avoid scrolling on touch
    // but only if it's touch, for mouse we might want default selection behavior to be prevented elsewhere
    if ('touches' in e) {
      // e.preventDefault(); // Sometimes needed, but can block essential touch actions. Testing without first.
    } else {
      e.preventDefault();
    }
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!isResizing) return;

      let clientX;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
      } else {
        clientX = (e as MouseEvent).clientX;
      }

      // Constrain width: Min 150px, Max 60% of screen
      let newWidth = clientX;
      if (newWidth < 150) newWidth = 150;
      if (newWidth > window.innerWidth * 0.6) newWidth = window.innerWidth * 0.6;

      // Written straight to the node instead of through state. Going through React
      // here re-rendered App - and with it every row of the file tree - on each of
      // the ~60 mousemove events per second of a drag. State is committed once, on
      // release, so nothing downstream sees the intermediate widths.
      dragWidthRef.current = newWidth;
      if (sidebarRef.current) sidebarRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (dragWidthRef.current !== null) {
        setSidebarWidth(dragWidthRef.current);
        writePref(PREF.sidebarWidth, dragWidthRef.current);
        dragWidthRef.current = null;
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // Disable text selection while dragging
    } else {
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);

      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing]);


  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
      <Header
        onSearchResultSelect={handleSearchResultSelect}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      {/* Global Resize Overlay: Crucial for smooth dragging over iframes/videos */}
      {isResizing && (
        <div className="fixed inset-0 z-[9999] cursor-col-resize bg-transparent" />
      )}

      <main className="relative flex flex-1 overflow-hidden">
        {/* Tap-anywhere-else to close, drawer only. */}
        {isNarrow && sidebarOpen && (
          <div
            className="absolute inset-0 z-30 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* 1. Sidebar Panel (Explorer) */}
        {sidebarOpen && (
        <div
          ref={sidebarRef}
          className={`flex flex-col border-r border-gray-800 ${isNarrow
            ? 'absolute inset-y-0 left-0 z-40 w-72 max-w-[85%] bg-gray-900 shadow-2xl'
            : 'flex-none bg-gray-900/50 backdrop-blur-sm'}`}
          // The drawer takes its width from the class above; only the column is
          // draggable, and dragging is what this number records.
          style={isNarrow ? undefined : { width: sidebarWidth }}
        >
          {/* Pick up where you left off. The positions behind this have been
              recorded all along; until now the only place they showed was a
              toast after the file was already open.

              What is playing stays in the list, marked the way the tree marks
              it. Leaving it out was tidier - pressing it does nothing - but it
              also meant the list said nothing about the film actually on screen,
              so starting something new looked like it had not been noticed. */}
          {recent.length > 0 && (
            <div className="flex-none border-b border-gray-800 pb-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 pt-4 pb-2">
                Continue watching
              </h2>
              {recent.map(item => {
                const playing = item.node.path === currentFile?.path;
                return (
                  <button
                    key={item.node.path}
                    type="button"
                    onClick={() => handleSelectFile(item.node)}
                    title={`${item.node.name} — ${playing ? 'playing now, at' : 'resume at'} ${formatTime(item.position)}`}
                    className={`relative w-full text-left px-4 py-1.5 cursor-pointer hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white ${playing ? 'bg-gray-700 border-l-2 border-blue-500' : ''}`}
                  >
                    <span className={`block truncate text-sm ${playing ? 'text-blue-300' : 'text-gray-200'}`}>
                      {item.node.name}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {formatTime(item.position)}
                      {item.fraction > 0 ? ` · ${Math.round(item.fraction * 100)}%` : ''}
                      {playing ? ' · playing' : ''}
                    </span>
                    {item.fraction > 0 && (
                      <span
                        className="absolute left-0 bottom-0 h-0.5 bg-blue-500"
                        style={{ width: `${Math.round(item.fraction * 100)}%` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-none flex justify-between items-center px-4 pt-4 mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Explorer</h2>
            {/* Picks up files added since the page loaded, without a reload and
                without stopping what is playing. Not disabled while it runs: a
                disabled button drops focus, which strands a remote. */}
            <button
              type="button"
              onClick={() => { if (!loading) loadLibrary(); }}
              aria-label="Rescan media folder"
              title="Rescan media folder"
              className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* A rescan keeps the tree it already has on screen; only the first
              load has nothing to show yet. */}
          {loading && fileTree.length === 0 ? (
            // Not "no files found": that is what this showed for the whole of the
            // first scan, which on a large library over Wi-Fi is long enough to
            // read as a broken MEDIA_DIR.
            <p className="px-4 py-3 text-sm text-gray-500 flex items-center space-x-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading your library…</span>
            </p>
          ) : loadError ? (
            <div className="px-4 py-3 m-2 rounded-md bg-red-950/40 border border-red-900 text-sm">
              <p className="font-semibold text-red-300">Could not load media</p>
              <p className="mt-1 text-red-200/80 break-words">{loadError}</p>
              <p className="mt-2 text-xs text-gray-400">
                Check that <code className="text-gray-300">MEDIA_DIR</code> in your{' '}
                <code className="text-gray-300">.env</code> points at a folder that exists,
                then restart the server.
              </p>
            </div>
          ) : fileTree.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">
              No video or audio files found in your media folder.
            </p>
          ) : (
            <FileTree
              nodes={fileTree}
              onSelectFile={handleSelectFile}
              currentFilePath={currentFile?.path || null}
              progress={watched.progress}
            />
          )}
        </div>
        )}

        {/* 2. Physical Resizer Handle */}
        {/* This sits physically between the sidebar and main content. A drawer
            has nothing to resize against, so it belongs to the column only. */}
        {sidebarOpen && !isNarrow && (
          <div
            onMouseDown={startResizing}
            onTouchStart={startResizing}
            className={`w-2 hover:w-2 flex-none cursor-col-resize z-50 flex items-center justify-center transition-colors
                ${isResizing ? 'bg-blue-600' : 'bg-gray-800 hover:bg-blue-500'}`}
          >
            {/* Grip handle visual indicator */}
            <div className="w-0.5 h-8 bg-gray-500 rounded-full pointer-events-none" />
          </div>
        )}

        {/* 3. Main Media Content */}
        {/* min-h-0 rather than overflow-auto: the player is h-full, so with the
            file details below it the column used to overflow its own height and
            grow a scrollbar, parking the details below the fold. */}
        <div className="flex-1 flex flex-col p-3 md:p-4 overflow-hidden min-w-0 min-h-0">
          <div className="flex-1 min-h-0">
            {/* A crash in the player stays in the player: the library keeps
                working, and picking another file tries again. */}
            <ErrorBoundary what="player" resetKey={currentFile?.path || null}>
              <MediaPlayer
                filePath={currentFile?.path || null}
                fileName={currentFile?.name || null}
                mimeType={currentFile?.mimeType || null}
                siblings={siblingsWithSaved}
                onSubtitlesSaved={handleSubtitlesSaved}
                onProgress={handleProgress}
                onEnded={handleMediaEnded}
                autoPlay={true}
                onNext={nextFile ? handleNext : undefined}
                nextName={nextFile?.name || null}
                onPrevious={currentIndex > 0 ? handlePrevious : undefined}
              />
            </ErrorBoundary>
          </div>

          {currentFile && (
            <div className="flex-none mt-3 px-3 py-2 bg-gray-800/50 rounded-lg">
              <h2 className="text-base font-medium text-white truncate" title={currentFile.name}>
                {currentFile.name}
              </h2>
              <p className="text-xs text-gray-400 font-mono truncate" title={currentFile.path}>
                {currentFile.path}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;