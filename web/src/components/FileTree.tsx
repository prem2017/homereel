import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FileNode } from '../types';
import { ChevronRight, ChevronDown, FileVideo, FileAudio, Folder } from 'lucide-react';
import { normalizeKey } from '../utils/keys';
import { createNumberStore } from '../utils/localNumbers';

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (file: FileNode) => void;
  currentFilePath: string | null;
  /** How far through each file playback got, 0-1, for the bar under the row. */
  progress?: Map<string, number>;
}

/**
 * Which folders were left open.
 *
 * A number store used as a set: the value carries nothing and the key is the
 * whole point, but this way the quota trimming and the never-throw handling are
 * the same ones the resume positions get rather than a second copy of both.
 * Without this every reload dropped the user back at the top of the library and
 * made them walk down to their series again.
 */
const openFolderStore = createNumberStore('media-player:open-folders', 400);

// One visible line. The tree is flattened to a list before rendering rather than
// recursed through during it: expansion state then lives in a single Set on the
// container, so opening a folder re-renders the rows that changed instead of every
// node in the library, and arrow-key navigation becomes an index step.
interface Row {
  node: FileNode;
  depth: number;
  isOpen: boolean;
}

/**
 * Every directory enclosing `filePath`, outermost first.
 *
 * Built from the path's own segments rather than a startsWith() test, which treated
 * "Movies" as an ancestor of "Movies2/film.mp4" and expanded the wrong folder.
 */
export const ancestorPaths = (filePath: string): string[] => {
  const segments = filePath.split('/');
  segments.pop();

  const out: string[] = [];
  let ancestor = '';
  for (const segment of segments) {
    ancestor = ancestor ? `${ancestor}/${segment}` : segment;
    out.push(ancestor);
  }
  return out;
};

export const flatten = (nodes: FileNode[], openPaths: Set<string>, depth = 0, out: Row[] = []): Row[] => {
  for (const node of nodes) {
    const isOpen = node.type === 'directory' && openPaths.has(node.path);
    out.push({ node, depth, isOpen });
    if (isOpen && node.children) flatten(node.children, openPaths, depth + 1, out);
  }
  return out;
};

// The DOM id App.tsx scrolls a search hit into view by.
export const rowDomId = (path: string) => `file-node-${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

const getIcon = (node: FileNode) => {
  if (node.type === 'directory') return <Folder size={16} className="text-yellow-500" />;
  if (node.mimeType?.startsWith('audio')) return <FileAudio size={16} className="text-purple-400" />;
  return <FileVideo size={16} className="text-blue-400" />;
};

const FileTreeRow: React.FC<{
  node: FileNode;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
  tabIndex: number;
  // A number rather than the whole map, so React.memo still sees a row whose
  // progress has not moved as unchanged.
  progress?: number;
  onActivate: (node: FileNode) => void;
  onFocus: (path: string) => void;
}> = React.memo(({ node, depth, isOpen, isSelected, tabIndex, progress, onActivate, onFocus }) => {
  const isDirectory = node.type === 'directory';
  const watched = progress ? Math.round(progress * 100) : 0;

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isDirectory ? isOpen : undefined}
      aria-selected={isSelected}
      aria-level={depth + 1}
      // Roving tabIndex: only one row is a tab stop, so Tab moves past the tree
      // rather than through every file in the library.
      tabIndex={tabIndex}
      id={rowDomId(node.path)}
      data-row="1"
      title={watched ? `${node.name} — ${watched}% watched` : node.name}
      onClick={() => onActivate(node)}
      onFocus={() => onFocus(node.path)}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      // focus:, not focus-visible: - :focus-visible needs Chrome 86 and the TVs this
      // is built for are Chromium 47, where the focus style would never appear at all.
      // A solid background rather than a ring, for the same reason and because it
      // reads from across a room.
      className={`relative w-full flex items-center py-1 px-2 text-left cursor-pointer transition-colors hover:bg-gray-800 focus:outline-none focus:bg-blue-700 focus:text-white ${isSelected ? 'bg-gray-700 text-blue-300 border-l-2 border-blue-500' : 'text-gray-300'}`}
    >
      <span className="mr-2 opacity-70">
        {isDirectory
          ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
          : <div className="w-3.5" />}
      </span>
      <span className="mr-2">{getIcon(node)}</span>
      <span className="truncate text-sm">{node.name}</span>

      {/* How far in this file was left. The player has been recording it all
          along; until now the only place it showed was a toast after the file
          was already open, which is too late to be the reason you picked it. */}
      {watched > 0 && (
        <span
          className="absolute left-0 bottom-0 h-0.5 bg-blue-500"
          style={{ width: `${watched}%` }}
        />
      )}
    </button>
  );
});
FileTreeRow.displayName = 'FileTreeRow';

export const filterTree = (nodes: FileNode[]): FileNode[] => {
  return nodes
    .map(node => {
      if (node.type === 'directory') {
        const filteredChildren = filterTree(node.children || []);
        if (filteredChildren.length > 0) {
          return { ...node, children: filteredChildren };
        }
        return null;
      }

      // Media only. A subtitle is not something to play, it is something to
      // choose inside the player - and once downloads land next to the video,
      // listing them here buries the films under their own subtitles.
      const isMedia = node.mimeType?.startsWith('video/') || node.mimeType?.startsWith('audio/');

      return isMedia ? node : null;
    })
    .filter((node): node is FileNode => node !== null);
};

export const FileTree: React.FC<FileTreeProps> = ({ nodes, onSelectFile, currentFilePath, progress }) => {
  const filteredNodes = React.useMemo(() => filterTree(nodes), [nodes]);
  const [openPaths, setOpenPaths] = useState<Set<string>>(
    () => new Set(openFolderStore.entries().map(([path]) => path)),
  );
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => flatten(filteredNodes, openPaths), [filteredNodes, openPaths]);

  // Persisted by diffing the set against what is stored, rather than by writing
  // from inside `toggleOpen`: a state updater may run twice, and that is not a
  // place to put a side effect. A folder that has since been deleted is simply
  // never flattened, so a stale entry costs nothing and cleans itself up the
  // next time the folder above it is closed.
  useEffect(() => {
    const stored = new Set(openFolderStore.entries().map(([path]) => path));
    openPaths.forEach(path => { if (!stored.has(path)) openFolderStore.write(path, 1); });
    stored.forEach(path => { if (!openPaths.has(path)) openFolderStore.write(path, null); });
  }, [openPaths]);

  // Reveal whatever is playing by opening the folders it sits in.
  useEffect(() => {
    if (!currentFilePath) return;
    const ancestors = ancestorPaths(currentFilePath);
    if (ancestors.length === 0) return;

    setOpenPaths(prev => {
      const next = new Set(prev);
      let added = false;
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          added = true;
        }
      }
      // Returning prev unchanged keeps this from re-rendering the tree on every
      // selection inside an already-open folder.
      return added ? next : prev;
    });
  }, [currentFilePath]);

  const toggleOpen = useCallback((path: string) => {
    setOpenPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const activate = useCallback((node: FileNode) => {
    if (node.type === 'directory') toggleOpen(node.path);
    else onSelectFile(node);
  }, [onSelectFile, toggleOpen]);

  const focusRowAt = useCallback((index: number) => {
    const elements = containerRef.current?.querySelectorAll<HTMLElement>('[data-row]');
    elements?.[index]?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex(r => r.node.path === focusedPath);
    if (index < 0) return;
    const row = rows[index];

    // Enter and Space are deliberately absent: the rows are real <button>s, so the
    // browser already turns those into a click. Handling them here would fire twice.
    switch (normalizeKey(e.nativeEvent)) {
      case 'ArrowDown':
        e.preventDefault();
        focusRowAt(Math.min(index + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRowAt(Math.max(index - 1, 0));
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.node.type === 'directory' && !row.isOpen) toggleOpen(row.node.path);
        else focusRowAt(Math.min(index + 1, rows.length - 1));
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (row.node.type === 'directory' && row.isOpen) {
          toggleOpen(row.node.path);
          break;
        }
        // Otherwise step out to the enclosing folder.
        for (let i = index - 1; i >= 0; i--) {
          if (rows[i].depth === row.depth - 1) {
            focusRowAt(i);
            break;
          }
        }
        break;
      }
      default:
        return;
    }
    // Keep D-pad navigation inside the tree: without this the player's window-level
    // handler would also see the arrow press and seek the video.
    e.stopPropagation();
  };

  // Whichever row is focused is the tab stop; falling back to the first row means the
  // tree is always reachable with a single Tab from the search box.
  const tabStopPath = focusedPath && rows.some(r => r.node.path === focusedPath)
    ? focusedPath
    : rows[0]?.node.path;

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Media files"
      // flex-1/min-h-0 rather than h-full: it is one flex child among several in
      // the sidebar now, and 100% of the container next to a sibling means the
      // last rows of a long library hang below the window with no way to scroll
      // to them.
      className="flex-1 min-h-0 overflow-y-auto pb-10"
      onKeyDown={handleKeyDown}
    >
      {/* ponytail: renders every expanded row, no virtualization (ceiling: ~2k visible
          rows stays smooth now that rows are memoized). Upgrade: windowing if anyone
          keeps a library large enough to expand past that. */}
      {rows.map(({ node, depth, isOpen }) => (
        <FileTreeRow
          key={node.path}
          node={node}
          depth={depth}
          isOpen={isOpen}
          isSelected={node.path === currentFilePath}
          tabIndex={node.path === tabStopPath ? 0 : -1}
          progress={node.type === 'file' ? progress?.get(node.path) : undefined}
          onActivate={activate}
          onFocus={setFocusedPath}
        />
      ))}
    </div>
  );
};
