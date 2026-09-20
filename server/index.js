const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream');
const mime = require('mime-types');

const { MEDIA_ROOT, resolveMediaPath, toRelative } = require('./mediaPath');
const { searchSubtitles, checkReference, downloadSubtitle } = require('./subtitles');
const { decodeSubtitle } = require('./subtitles/store');
const subtitleConfig = require('./subtitles/config');
const { resolveProviders, providerStatus } = require('./subtitles/providers');

const app = express();
const PORT = process.env.PORT || 5000;

// Where the built frontend lives. Docker overrides this; locally it is web/dist.
const WEB_DIST = path.resolve(process.env.WEB_DIST || path.join(__dirname, '..', 'web', 'dist'));

// Guards against a symlink loop inside the media directory turning the
// recursive scan into unbounded recursion.
// ponytail: fixed depth cap (ceiling: nesting <= 25 dirs). Upgrade: track
// visited inodes via fs.realpathSync if anyone hits the limit legitimately.
const MAX_DEPTH = 25;

// How a folder is listed: "Episode 2" before "Episode 10", case ignored.
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

app.set('trust proxy', true);
app.use(express.json());
// No CORS: the interface is served from this origin, and in development Vite
// proxies /api. Allowing other origins only lets any website someone on the
// network has open read the library and start subtitle downloads.

// Logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - IP: ${req.ip} - Device: ${req.headers['user-agent']}`);
    next();
});

// API: Remote Logging - lets a TV browser with no devtools report errors here.
app.get('/api/log', (req, res) => res.status(405).send('Use POST'));
app.post('/api/log', (req, res) => {
    const { level, message } = req.body || {};
    const timestamp = new Date().toLocaleString();
    // Anything on the network can post here, so neither field is trusted to be a
    // string. Continuation lines are indented, so a report cannot pass a line of
    // its own off as another [REMOTE ...] entry.
    const tag = String(level || 'log').toUpperCase().slice(0, 16);
    const text = String(message).slice(0, 4000).replace(/\r?\n/g, '\n    ');
    console.log(`[REMOTE ${tag}] [${timestamp}] ${text}`);
    res.sendStatus(200);
});

// 1. Recursive Directory Scanner
// ponytail: rescans the whole tree on every /api/files and /api/search call
// (ceiling: ~5k files feels instant, ~50k noticeably blocks the event loop).
// Upgrade: cache the tree and invalidate with fs.watch when it gets slow.
const getFileTree = (dir, depth = 0) => {
    if (depth > MAX_DEPTH) return [];

    const results = [];
    // Sorted: readdir hands back byte order - "Episode 10" before "Episode 2",
    // every capital before every small letter - and Next and autoplay step
    // through this list in the order it is in.
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => NAME_ORDER.compare(a.name, b.name));

    entries.forEach((entry) => {
        // Skip hidden files
        if (entry.name.startsWith('.')) return;

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
            results.push({
                name: entry.name,
                path: toRelative(filePath),
                type: 'directory',
                children: getFileTree(filePath, depth + 1)
            });
        } else if (stat.isFile()) {
            results.push({
                name: entry.name,
                path: toRelative(filePath),
                type: 'file',
                mimeType: mime.lookup(filePath) || 'application/octet-stream'
            });
        }
    });
    return results;
};

// 2. Search Helper
//
// Release names spell a space as "." or "_" and titles carry accents, so text is
// compared as words: accents off, case folded, anything that is not a letter,
// digit or combining mark read as a space. Only the Latin combining accents
// (U+0300-036F) come off - Devanagari vowel signs are marks too, and dropping
// those would change the word.
const searchKey = (text) => text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

// API: Get Files
app.get('/api/files', (req, res) => {
    try {
        if (!fs.existsSync(MEDIA_ROOT)) {
            return res.status(500).json({ error: `Media directory not found: ${MEDIA_ROOT}` });
        }
        res.json(getFileTree(MEDIA_ROOT));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to scan files' });
    }
});

// API: Search
app.get('/api/search', (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const type = typeof req.query.type === 'string' ? req.query.type : 'all';
        const tree = getFileTree(MEDIA_ROOT);
        res.json(searchTree(tree, query, type));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Errors that just mean "the viewer went away mid-download". A player that seeks
// aborts its in-flight request every time, so these are routine, not faults.
const CLIENT_GONE = ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE'];

// Without a validator the browser re-fetches every byte it already has, so seeking
// backwards costs a full disk read and another trip over the Wi-Fi. Media files are
// effectively immutable once written, which is what makes an hour of caching safe.
const cacheHeaders = (stat) => ({
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'private, max-age=3600',
});

/**
 * Send a file (or a slice of one) to the response.
 *
 * Uses pipeline() rather than createReadStream().pipe(res): pipe leaves the read
 * stream open when the client disconnects, and since every seek aborts a request,
 * a session of seeking around a film leaks a file descriptor per seek until the
 * process runs out. pipeline() tears down both ends however it ends.
 */
const sendFile = (res, filePath, options) => {
    pipeline(fs.createReadStream(filePath, options), res, (err) => {
        if (err && !CLIENT_GONE.includes(err.code)) {
            console.error(`Stream failed for ${filePath}: ${err.message}`);
        }
    });
};

// API: Stream Video/Audio (supports Range requests so the player can seek)
app.get('/api/stream', (req, res) => {
    const filePath = resolveMediaPath(req.query.path);
    if (!filePath) return res.status(403).send('Access denied');

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        return res.status(404).send('File not found');
    }
    if (!stat.isFile()) return res.status(404).send('File not found');

    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // A malformed or out-of-bounds Range must not become a negative-length
        // read; answer per RFC 7233 instead.
        if (Number.isNaN(start) || start >= fileSize || end < start) {
            return res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }).end();
        }
        const safeEnd = Math.min(end, fileSize - 1);

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${safeEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': (safeEnd - start) + 1,
            'Content-Type': mimeType,
            ...cacheHeaders(stat),
        });
        sendFile(res, filePath, { start, end: safeEnd });
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Content-Type': mimeType,
            ...cacheHeaders(stat),
        });
        sendFile(res, filePath);
    }
});

// API: a subtitle's text, always as UTF-8. The player reads subtitles as text and
// fetch().text() only knows UTF-8, but the subtitles people already have are
// often in whatever codepage their author's editor used - read raw through
// /api/stream they come out as "Caf�". Decoded by the same function that
// decodes a download, so the two cannot disagree.
const SUBTITLE_FILE = /\.(srt|vtt)$/i;

app.get('/api/subtitles/text', async (req, res) => {
    const filePath = resolveMediaPath(req.query.path);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    if (!SUBTITLE_FILE.test(filePath)) return res.status(400).json({ error: 'Not a subtitle file.' });

    let stat;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (e) {
        return res.status(404).json({ error: 'File not found' });
    }
    if (!stat.isFile()) return res.status(404).json({ error: 'File not found' });
    // Read whole into memory, so capped. A subtitle is tens of kilobytes.
    if (stat.size > subtitleConfig.maxSubtitleBytes) {
        return res.status(413).json({ error: 'That subtitle file is too large.' });
    }

    try {
        const text = decodeSubtitle(await fs.promises.readFile(filePath));
        res.set('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send(text);
    } catch (e) {
        console.error(`Could not read ${filePath}: ${e.message}`);
        res.status(500).json({ error: 'Could not read that subtitle file.' });
    }
});

// ---------------------------------------------------------------------------
// Subtitles
//
// Search and download are separate calls on purpose. Providers meter downloads
// (OpenSubtitles allows a handful a day) but not searches, so the client can
// browse candidates freely and spend quota only when it actually takes one.
// ---------------------------------------------------------------------------

// The language codes come from .env, so the client asks rather than hard-coding
// them. Provider status rides along: the UI needs to explain "no subtitle
// sources configured" rather than showing a menu that can never return anything.
/**
 * What the by-id box has to say for itself.
 *
 * Reported separately from `providers` because it *is* separate: Subscene is not
 * selected by SUBTITLE_PROVIDERS and is not searched, so the panel cannot infer
 * anything about it from that list. It needs the address the box will use and
 * whether it is switched on - otherwise a dead box has no explanation but the
 * one that arrives after an id has been typed and Get pressed. Neither is a
 * secret: the address ships as the default in .env.example.
 *
 * A second download-by-id source would turn this into a list. There is one.
 */
const subsceneInfo = () => {
    const status = providerStatus('subscene');
    const base = subtitleConfig.subsceneUrl;
    let site = base;
    // Shown, not fetched, so an unparseable value is echoed back rather than
    // hidden - seeing what .env actually says is the whole point of showing it.
    try { site = base ? new URL(base).host : ''; } catch { /* keep it as typed */ }

    return { site, ready: status.ok, reason: status.ok ? null : status.reason };
};

app.get('/api/subtitles/languages', (req, res) => {
    const { active, problems } = resolveProviders();
    res.json({
        languages: subtitleConfig.languages,
        providers: active.map((p) => p.name),
        unavailable: problems,
        subscene: subsceneInfo(),
    });
});

// Reject a language the user cannot have chosen from the menu. Providers treat
// an unknown code as "no results", which looks identical to a broken feature.
const validLanguage = (value) =>
    typeof value === 'string' && subtitleConfig.languages.some((l) => l.code === value);

app.get('/api/subtitles/search', async (req, res) => {
    const { path: videoPath, language } = req.query;
    if (!validLanguage(language)) return res.status(400).json({ error: 'Unsupported language.' });

    try {
        const result = await searchSubtitles({ videoRelPath: videoPath, language });
        res.json(result);
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

// Whether a reference the user is typing leads anywhere, asked before Get is
// offered. Never metered: only a source whose lookups are free implements
// `check`, which is why this can be called on a pause in typing.
app.get('/api/subtitles/check', async (req, res) => {
    const { provider, ref } = req.query;
    if (typeof provider !== 'string' || typeof ref !== 'string') {
        return res.status(400).json({ error: 'A provider and reference are required.' });
    }

    try {
        res.json(await checkReference({ provider, ref }));
    } catch (e) {
        res.status(e.status || 502).json({ error: e.message });
    }
});

app.post('/api/subtitles/download', async (req, res) => {
    const { path: videoPath, language, provider, ref } = req.body || {};
    // Optional here, unlike on the search path. A subtitle taken by id was picked
    // on the provider's own page, which states what language it is - so there is
    // nothing for the menu to decide, and requiring it would only invite a wrong
    // answer. Sent, it is a fallback for when nothing else knows.
    if (language !== undefined && language !== '' && !validLanguage(language)) {
        return res.status(400).json({ error: 'Unsupported language.' });
    }
    if (typeof provider !== 'string' || typeof ref !== 'string') {
        return res.status(400).json({ error: 'A provider and reference are required.' });
    }

    try {
        const saved = await downloadSubtitle({
            videoRelPath: videoPath, language: language || null, provider, ref,
        });
        res.json(saved);
    } catch (e) {
        console.error(`Subtitle download failed: ${e.message}`);
        res.status(e.status || 502).json({ error: e.message });
    }
});

// Vite gives every built asset a content hash, so a changed file always gets a
// new name. Those are safe to cache forever; index.html is the only thing that
// maps to the current hashes and must never be cached.
//
// This is not a micro-optimisation. express.static defaults to
// `Cache-Control: public, max-age=0`, and SamsungBrowser 2.0 (Tizen 3.0) reads
// that as licence to reuse a stale copy without revalidating. After a rebuild the
// TV kept loading a pre-fix bundle - it re-requested /api/files but never / or
// /assets/*.js - which made a fixed bug look unfixed.
const NO_STORE = 'no-store, no-cache, must-revalidate';
const HASHED_ASSET = /-[0-9a-f]{8}\.(js|css)$/;

const setCacheHeaders = (res, filePath) => {
    if (HASHED_ASSET.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
        res.setHeader('Cache-Control', NO_STORE);
        res.setHeader('Pragma', 'no-cache'); // Tizen 3.0 predates HTTP/1.1-only caches.
    }
};

// Serve the built frontend
app.use(express.static(WEB_DIST, { setHeaders: setCacheHeaders }));

// Any non-API route falls through to the SPA entry point.
app.get('*', (req, res) => {
    const indexHtml = path.join(WEB_DIST, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        return res.status(503).send(
            'Frontend has not been built yet. Run "npm run build" (or use scripts/run).'
        );
    }
    setCacheHeaders(res, indexHtml);
    res.sendFile(indexHtml);
});

// Virtual adapters (Docker bridges, VPNs, VM hosts) also report non-internal
// IPv4 addresses, but none of them are reachable from a TV on the Wi-Fi.
// Listing them just makes it unclear which URL to type.
const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|zt|tailscale|wg)/i;

// The addresses worth showing, best candidate first.
const lanAddresses = () => Object.entries(os.networkInterfaces())
    .filter(([name]) => !VIRTUAL_IFACE.test(name))
    .flatMap(([, addrs]) => addrs || [])
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

const start = () => app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Media Player is running\n`);
    console.log(`  Serving media from : ${MEDIA_ROOT}`);
    console.log(`  Frontend build     : ${WEB_DIST}`);
    console.log(`  On this computer   : http://localhost:${PORT}`);

    // Inside a container the only visible addresses belong to Docker's private
    // network, which a TV on the Wi-Fi cannot reach. Printing them would send
    // people to a dead URL, so point at the host instead.
    if (fs.existsSync('/.dockerenv')) {
        console.log(`  On your TV / phone : http://<this computer's IP>:${PORT}`);
        console.log(`                       (./scripts/run-docker prints the exact address)`);
    } else {
        lanAddresses().forEach((ip) => {
            console.log(`  On your TV / phone : http://${ip}:${PORT}`);
        });
    }
    console.log('');

    if (!fs.existsSync(MEDIA_ROOT)) {
        console.warn(`  WARNING: media directory does not exist: ${MEDIA_ROOT}`);
        console.warn(`  Set MEDIA_DIR in your .env file to point at your media folder.\n`);
    }
});

// Run directly - node, Docker, run-dev - this listens. Required by the tests it
// only hands the app over, so they can listen on a port of their own.
if (require.main === module) start();

module.exports = app;
