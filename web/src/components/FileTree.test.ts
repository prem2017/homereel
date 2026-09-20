import { describe, it, expect } from 'vitest';
import { ancestorPaths, flatten, filterTree } from './FileTree';
import { FileNode } from '../types';

const tree: FileNode[] = [
    {
        name: 'Movies', path: 'Movies', type: 'directory', children: [
            { name: 'a.mp4', path: 'Movies/a.mp4', type: 'file', mimeType: 'video/mp4' },
        ]
    },
    {
        name: 'Movies2', path: 'Movies2', type: 'directory', children: [
            { name: 'b.mp4', path: 'Movies2/b.mp4', type: 'file', mimeType: 'video/mp4' },
        ]
    },
];

describe('ancestorPaths', () => {
    it('lists each enclosing folder, outermost first', () => {
        expect(ancestorPaths('Shows/Season 1/ep1.mp4')).toEqual(['Shows', 'Shows/Season 1']);
    });

    it('returns nothing for a file at the root', () => {
        expect(ancestorPaths('film.mp4')).toEqual([]);
    });

    // The bug this replaced: a startsWith() test made "Movies" an ancestor of
    // anything under "Movies2", so selecting a file expanded the wrong folder.
    it('does not treat Movies as an ancestor of Movies2', () => {
        expect(ancestorPaths('Movies2/b.mp4')).toEqual(['Movies2']);
        expect(ancestorPaths('Movies2/b.mp4')).not.toContain('Movies');
    });

    it('copes with folder names that contain spaces', () => {
        expect(ancestorPaths('Shows/Season 1/ep1.mp4')).toContain('Shows/Season 1');
    });
});

describe('flatten', () => {
    it('shows only top-level rows when nothing is expanded', () => {
        const rows = flatten(tree, new Set());
        expect(rows.map(r => r.node.path)).toEqual(['Movies', 'Movies2']);
        expect(rows.every(r => r.depth === 0)).toBe(true);
    });

    it('reveals children of expanded folders, with depth', () => {
        const rows = flatten(tree, new Set(['Movies']));
        expect(rows.map(r => r.node.path)).toEqual(['Movies', 'Movies/a.mp4', 'Movies2']);
        expect(rows[1].depth).toBe(1);
        expect(rows[0].isOpen).toBe(true);
        expect(rows[2].isOpen).toBe(false);
    });

    it('expanding Movies2 leaves Movies closed', () => {
        const rows = flatten(tree, new Set(['Movies2']));
        expect(rows.map(r => r.node.path)).toEqual(['Movies', 'Movies2', 'Movies2/b.mp4']);
    });

    it('produces the row order arrow-key navigation steps through', () => {
        // Up/Down move by one index, so flatten order is the visual order.
        const rows = flatten(tree, new Set(['Movies', 'Movies2']));
        expect(rows.map(r => r.node.path)).toEqual([
            'Movies', 'Movies/a.mp4', 'Movies2', 'Movies2/b.mp4',
        ]);
    });

    it('never marks a file as open even if its path is in the set', () => {
        const rows = flatten(tree, new Set(['Movies', 'Movies/a.mp4']));
        expect(rows.find(r => r.node.path === 'Movies/a.mp4')!.isOpen).toBe(false);
    });
});

describe('filterTree', () => {
    const withSubtitles: FileNode[] = [
        {
            name: 'Movies', path: 'Movies', type: 'directory', children: [
                { name: 'a.mp4', path: 'Movies/a.mp4', type: 'file', mimeType: 'video/mp4' },
                { name: 'OS_A_1080p_en1.srt', path: 'Movies/OS_A_1080p_en1.srt', type: 'file', mimeType: 'application/x-subrip' },
                { name: 'a.vtt', path: 'Movies/a.vtt', type: 'file', mimeType: 'text/vtt' },
                { name: 'poster.jpg', path: 'Movies/poster.jpg', type: 'file', mimeType: 'image/jpeg' },
            ]
        },
        {
            name: 'Subs', path: 'Subs', type: 'directory', children: [
                { name: 'x.srt', path: 'Subs/x.srt', type: 'file', mimeType: 'application/x-subrip' },
            ]
        },
    ];

    // Subtitles are chosen inside the player, never played from the list - and a
    // folder of films each with three downloaded subtitles is four times as long
    // as it should be.
    it('lists media and leaves subtitles out', () => {
        const [movies] = filterTree(withSubtitles);
        expect(movies.children!.map(c => c.name)).toEqual(['a.mp4']);
    });

    it('drops a folder that held nothing but subtitles', () => {
        expect(filterTree(withSubtitles).map(n => n.name)).toEqual(['Movies']);
    });
});
