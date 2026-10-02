const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const ptt = require('parse-torrent-title');

const { MEDIA_ROOT, toRelative } = require('./mediaPath');

// Guards against a symlink loop inside the media directory turning the
// recursive scan into unbounded recursion.
// ponytail: fixed depth cap (ceiling: nesting <= 25 dirs). Upgrade: track
// visited inodes via fs.realpathSync if anyone hits the limit legitimately.
const MAX_DEPTH = 25;

// How a folder is listed: "Episode 2" before "Episode 10", case ignored.
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Pictures a media folder already carries, by the names Kodi, Plex and Jellyfin
// use: one for the whole folder, best first...
const FOLDER_ART = ['poster', 'folder', 'cover', 'front', 'album'];
// ...and one beside a single file, named after it ("Film.jpg", "Film-poster.jpg").
const FILE_ART_SUFFIXES = ['-poster', '-thumb', ''];
const ART_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const isMediaType = (mimeType) => /^(video|audio)\//.test(mimeType);

// "Le.Bureau.des.Legendes" -> "Le Bureau des Legendes", for names the release
// parser has nothing to say about.
const tidy = (text) => text.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

// s01e05 however it is written - "S01E05", "s01.e05", "1x05".
const EPISODE_MARKER = /s(\d{1,2})[\s._-]*e(\d{1,3})(?!\d)|(?:^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?!\d)/i;

// A leading track number on a song: "01 - Title", "01. Title", "1 Title".
const TRACK = /^(\d{1,3})(?:\s*[-.)_]\s*|\s+)(.+)$/;

/**
 * What a media file's name says about it, for showing - never for finding: the
 * path stays the identifier everywhere.
 *
 * Videos go through the release parser the subtitle naming already uses, so
 * "Big.Buck.Bunny.2008.1080p.BluRay.x264.mp4" reads as Big Buck Bunny, 2008,
 * 1080p. Songs do not: it reads "01 - Nocturne in E-flat major" as a title of
 * "01 - Nocturne in E" from group "major", so a song is a track number and the
 * rest. Keys are only present when known.
 */
const describeMedia = (fileName, mimeType) => {
    const base = fileName.replace(/\.[^.]+$/, '');
    if (/^audio\//.test(mimeType)) {
        const numbered = TRACK.exec(base);
        return numbered ? { title: tidy(numbered[2]), track: Number(numbered[1]) } : { title: tidy(base) };
    }

    let parsed;
    try {
        parsed = ptt.parse(base);
    } catch (e) {
        return { title: tidy(base) };
    }
    const info = { title: parsed.title || tidy(base) };
    if (parsed.year) info.year = parsed.year;
    if (Number.isInteger(parsed.season)) info.season = parsed.season;
    if (Number.isInteger(parsed.episode)) info.episode = parsed.episode;
    if (parsed.resolution) info.resolution = parsed.resolution;
    if (parsed.source) info.source = parsed.source;
    if (parsed.codec) info.codec = parsed.codec;

    // An episode's own title sits after its marker: "Show.S01E01.Pilot.720p".
    // Whatever the parser makes of the rest is that title, unless it is only a
    // release token ("720p" parses as a title of "720p").
    const marker = info.episode !== undefined ? EPISODE_MARKER.exec(base) : null;
    if (marker) {
        const rest = base.slice(marker.index + marker[0].length).replace(/^[\s._-]+/, '');
        const own = rest ? ptt.parse(rest).title : '';
        const token = [info.resolution, info.source, info.codec].filter(Boolean).map((t) => t.toLowerCase());
        if (own && /\p{L}/u.test(own) && !/^\d{3,4}[pi]$/i.test(own) && !token.includes(own.toLowerCase())) {
            info.episodeTitle = own;
        }
    }
    return info;
};

/** The first of `candidates` present in `names` (lower-cased), as a relative path. */
const artIn = (dir, names, candidates) => {
    for (const candidate of candidates) {
        for (const ext of ART_EXTENSIONS) {
            const name = names.get(`${candidate}.${ext}`.toLowerCase());
            if (name) return toRelative(path.join(dir, name));
        }
    }
    return undefined;
};

// 1. Recursive Directory Scanner
//
// Every file carries its size and modification time (the scan stats each entry
// anyway), and every media file what its name says (`describeMedia`). A folder
// with a poster or cover carries it as `art`, and so does a file with its own.
const getFileTree = (dir, depth = 0) => {
    if (depth > MAX_DEPTH) return [];

    // Sorted: readdir hands back byte order - "Episode 10" before "Episode 2",
    // every capital before every small letter - and Next and autoplay step
    // through this list in the order it is in.
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.')) // Skip hidden files
        .sort((a, b) => NAME_ORDER.compare(a.name, b.name));
    const names = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry.name]));

    const results = [];
    entries.forEach((entry) => {
        const filePath = path.join(dir, entry.name);
        let stat;
        try {
            // stat() follows symlinks, so a symlinked media folder still works.
            stat = fs.statSync(filePath);
        } catch (e) {
            // Broken symlink or a file we lack permission to read - skip it
            // rather than failing the entire listing.
            return;
        }

        if (stat.isDirectory()) {
            const children = getFileTree(filePath, depth + 1);
            const node = { name: entry.name, path: toRelative(filePath), type: 'directory', children };
            const childNames = new Map(children.filter((c) => c.type === 'file').map((c) => [c.name.toLowerCase(), c.name]));
            const art = artIn(filePath, childNames, FOLDER_ART);
            if (art) node.art = art;
            results.push(node);
        } else if (stat.isFile()) {
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            const node = {
                name: entry.name,
                path: toRelative(filePath),
                type: 'file',
                mimeType,
                size: stat.size,
                mtime: Math.round(stat.mtimeMs),
            };
            if (isMediaType(mimeType)) {
                node.info = describeMedia(entry.name, mimeType);
                const base = entry.name.replace(/\.[^.]+$/, '');
                const art = artIn(dir, names, FILE_ART_SUFFIXES.map((suffix) => base + suffix));
                if (art) node.art = art;
            }
            results.push(node);
        }
    });
    return results;
};

// The library as last scanned, so neither a page load on a second screen nor a
// search walks the whole folder. A scan is synchronous and blocks streaming on a
// NAS or USB disk while it runs.
//
// Rebuilt when the client asks (`fresh`: the rescan button), when this server
// wrote into the folder (`forgetLibrary`: a subtitle download), and when it is
// older than a minute - a file copied in from elsewhere shows up within that
// without anyone pressing anything.
// ponytail: the scan itself is still synchronous (ceiling: ~50k files blocks
// noticeably, at most once a minute). Upgrade: an async walk, invalidated by
// fs.watch.
const TREE_MAX_AGE_MS = 60 * 1000;
let cached = null;

const libraryTree = ({ fresh = false } = {}) => {
    if (!fresh && cached && Date.now() - cached.at < TREE_MAX_AGE_MS) return cached.tree;
    const tree = getFileTree(MEDIA_ROOT);
    cached = { tree, at: Date.now() };
    return tree;
};

const forgetLibrary = () => { cached = null; };

// 2. Search Helper
//
// Release names spell a space as "." or "_" and titles carry accents, so text is
// compared as words: accents off, case folded, anything that is not a letter,
// digit or combining mark read as a space. Only the Latin combining accents
// (U+0300-036F) come off - Devanagari vowel signs are marks too, and dropping
// those would change the word.
const searchKey = (text) => text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();

// Every word of the query must appear somewhere in the file's path, folder names
// included, so "breaking bad s01e02" finds Breaking Bad/S01E02.mkv.
const searchTree = (nodes, query, type) => {
    const words = searchKey(query).split(' ').filter(Boolean);
    const results = [];
    if (words.length === 0) return results;

    const visit = (list) => {
        for (const node of list) {
            if (node.type === 'file') {
                const isVideo = node.mimeType?.startsWith('video');
                const isAudio = node.mimeType?.startsWith('audio');

                // "All" means every kind of media, not every file on disk. Selecting
                // a search hit starts playing it, and a subtitle - which now sits
                // next to every video that has one - is not something to play.
                const wanted = (type === 'all' && (isVideo || isAudio)) ||
                    (type === 'video' && isVideo) ||
                    (type === 'audio' && isAudio);

                if (wanted) {
                    const key = searchKey(node.path);
                    if (words.every((word) => key.includes(word))) results.push(node);
                }
            }
            if (node.children) visit(node.children);
        }
    };

    visit(nodes);
    return results;
};

module.exports = { describeMedia, getFileTree, libraryTree, forgetLibrary, searchKey, searchTree };
