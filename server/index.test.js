const test = require('node:test');
const { before, after, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The API as a client sees it, against a scratch media folder.
 *
 * Settings are fixed before the server is required, because config is read once
 * at load. SUBSCENE_URL points at loopback, which assertFetchable refuses: a test
 * that reaches a provider fails loudly instead of touching the network.
 */
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
process.env.MEDIA_DIR = MEDIA;
process.env.SUBSCENE_URL = 'http://127.0.0.1:9';
delete process.env.OPENSUBTITLES_API_KEY;
delete process.env.SUBDL_API_KEY;

const put = (relPath, content = '') => {
    const target = path.join(MEDIA, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
};

put('Show/Episode 10.mp4');
put('Show/Episode 2.mp4');
put('Show/Episode 1.mp4');
put('Show/apple.mp4');
put('Show/Zebra.mp4');
put('Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.1080p.mkv');
put('Breaking Bad/S01E01.mp4');
put('Breaking Bad/S01E01.srt', '1\n00:00:01,000 --> 00:00:02,000\nSay my name.\n');
put('Les Misérables (2012).mp4');
put('फ़िल्म.mp4');
put('Old/Amélie.srt', Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\nCaf\xe9 cr\xe8me\r\n', 'latin1'));
put('notes.txt', 'not media');

// Every request is logged; none of that is what these tests are about.
mock.method(console, 'log', () => { });

let server;
let base;

before(async () => {
    const app = require('./index');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    server.closeAllConnections();
    server.close();
});

const query = (params) => new URLSearchParams(params).toString();
const get = (route, options) => fetch(`${base}${route}`, options);
const post = (route, body) => get(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

test('lists a folder in the order a person reads it', async () => {
    // readdir hands back byte order - "Episode 10" before "Episode 2", every
    // capital before every small letter - and Next and autoplay follow the list.
    const tree = await (await get('/api/files')).json();
    const show = tree.find((node) => node.name === 'Show');

    assert.deepStrictEqual(
        show.children.map((node) => node.name),
        ['apple.mp4', 'Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4', 'Zebra.mp4']
    );
});

const search = async (q, type = 'all') =>
    (await (await get(`/api/search?${query({ q, type })}`)).json()).map((node) => node.path);

test('search matches words, whatever separates them and however they are accented', async () => {
    assert.deepStrictEqual(await search('bureau des'), ['Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.1080p.mkv']);
    assert.deepStrictEqual(await search('miserables'), ['Les Misérables (2012).mp4']);
});

test('search reads folder names too, and still lists media only', async () => {
    // The .srt beside the episode matches every word as well; selecting a hit
    // plays it, so it stays out.
    assert.deepStrictEqual(await search('breaking bad s01e01'), ['Breaking Bad/S01E01.mp4']);
});

test('search keeps working for scripts without Latin letters', async () => {
    assert.deepStrictEqual(await search('फ़िल्म'), ['फ़िल्म.mp4']);
});

test('search finds nothing for a query with no words in it, or of the wrong type', async () => {
    assert.deepStrictEqual(await search('..'), []);
    assert.deepStrictEqual(await search('bureau', 'audio'), []);
});

test('stream still refuses a path outside the media folder', async () => {
    for (const p of ['/etc/passwd', '../../etc/passwd']) {
        assert.strictEqual((await get(`/api/stream?${query({ path: p })}`)).status, 403);
    }
});

test('answers no cross-origin request', async () => {
    // The interface is served from this origin, and in development Vite proxies
    // /api. A CORS header would only let other websites read the library.
    const headers = { Origin: 'http://example.com', 'Access-Control-Request-Method': 'POST' };
    const listed = await get('/api/files', { headers });
    const preflight = await get('/api/subtitles/download', { method: 'OPTIONS', headers });

    assert.strictEqual(listed.headers.get('access-control-allow-origin'), null);
    assert.strictEqual(preflight.headers.get('access-control-allow-origin'), null);
});

test('a malformed log report is logged, not a crash', async () => {
    const response = await post('/api/log', { level: 1, message: { not: 'a string' } });
    assert.strictEqual(response.status, 200);
});

test('serves a local subtitle as UTF-8, whatever it was saved in', async () => {
    // The player reads a subtitle with fetch().text(), which only knows UTF-8, so
    // a windows-1252 file read raw comes out as "Caf�".
    const response = await get(`/api/subtitles/text?${query({ path: 'Old/Amélie.srt' })}`);

    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain; charset=utf-8/i);
    assert.match(await response.text(), /Café crème/);
});

test('the subtitle text route reads subtitles and nothing else', async () => {
    const status = async (p) => (await get(`/api/subtitles/text?${query({ path: p })}`)).status;

    assert.strictEqual(await status('notes.txt'), 400);
    assert.strictEqual(await status('Show/Episode 1.mp4'), 400);
    assert.strictEqual(await status('../outside.srt'), 403);
    assert.strictEqual(await status('Old/Missing.srt'), 404);
});

test('subtitle search and download need a video that is really there', async () => {
    // A downloaded subtitle is named after its video, so a path to nothing would
    // name one after a film that does not exist.
    const searched = await get(`/api/subtitles/search?${query({ path: 'No Such Film.mkv', language: 'en' })}`);
    assert.strictEqual(searched.status, 404);

    for (const video of ['No Such Film.mkv', 'notes.txt']) {
        const downloaded = await post('/api/subtitles/download', { path: video, provider: 'subscene', ref: '1234567' });
        assert.strictEqual(downloaded.status, 404);
    }
});
