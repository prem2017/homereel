const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decodeSubtitle, looksLikeSubtitle, extensionFor, freeTargetPath } = require('./store');

const SRT = '1\n00:00:01,000 --> 00:00:04,000\nHello there.\n';

test('accepts SRT and VTT cue timings', () => {
    assert.ok(looksLikeSubtitle(SRT));
    assert.ok(looksLikeSubtitle('WEBVTT\n\n00:01.000 --> 00:04.000\nHello.\n'));
});

test('rejects an HTML page served with HTTP 200', () => {
    // The failure this guard exists for: a provider link that quietly redirects
    // to an ad or login page. Without the check that HTML lands on disk next to
    // someone's films and the player just shows nothing.
    const page = '<!doctype html><html><body>Download starting…</body></html>';
    assert.strictEqual(looksLikeSubtitle(page), false);
});

test('rejects a subtitle format the player cannot render', () => {
    // ASS carries timings in its own syntax, so it must not pass as SRT.
    const ass = '[Events]\nDialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello.';
    assert.strictEqual(looksLikeSubtitle(ass), false);
});

test('decodes UTF-8 and keeps non-Latin text intact', () => {
    const text = decodeSubtitle(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nनमस्ते\n', 'utf8'));
    assert.ok(text.includes('नमस्ते'));
});

test('strips a UTF-8 byte order mark', () => {
    // A leading BOM before "WEBVTT" makes the browser reject the whole track.
    const text = decodeSubtitle(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('WEBVTT\n')]));
    assert.ok(text.startsWith('WEBVTT'));
});

test('falls back to windows-1252 rather than emitting replacement characters', () => {
    // A legacy SRT written in a single-byte codepage: 0xE9 is "é" there, and is
    // not valid UTF-8 at all. Strict UTF-8 would turn it into U+FFFD.
    const text = decodeSubtitle(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    assert.strictEqual(text, 'café');
});

test('decodes UTF-16 when a byte order mark says so', () => {
    // What Windows editors save as "Unicode". Read as UTF-8 or windows-1252 it has
    // a NUL between every character, and no cue timing can be found in it.
    const little = Buffer.from(`\ufeff${SRT}`, 'utf16le');
    const big = Buffer.from(little).swap16();

    assert.strictEqual(decodeSubtitle(little), SRT);
    assert.strictEqual(decodeSubtitle(big), SRT);
});

test('names the file by content, not by what the provider claimed', () => {
    assert.strictEqual(extensionFor('WEBVTT\n\n00:01.000 --> 00:02.000\n'), 'vtt');
    assert.strictEqual(extensionFor(SRT), 'srt');
});

const scratch = (videoName) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'substore-'));
    const video = path.join(dir, videoName);
    fs.writeFileSync(video, '');
    return video;
};

test('names a download by source, video, resolution and language', () => {
    const video = scratch('Ford.V.Ferrari.2019.720p.BluRay.x264-SPARKS.mkv');

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'en', 'srt')),
        'OS_Ford-V-Ferrari_720p_en1.srt'
    );
});

test('leaves the resolution out when the video name does not carry one', () => {
    const video = scratch('Holiday in Rome.mp4');

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'subdl', 'fr', 'srt')),
        'SD_Holiday-in-Rome_fr1.srt'
    );
});

test('never overwrites an existing subtitle, and counts on from it', () => {
    // "Try another one" has to be non-destructive: the rejected subtitle stays
    // on disk so it can be picked again from the list.
    const video = scratch('Ford.V.Ferrari.2019.720p.mkv');

    const first = freeTargetPath(video, 'opensubtitles', 'en', 'srt');
    fs.writeFileSync(first, SRT);

    const second = freeTargetPath(video, 'opensubtitles', 'en', 'srt');
    assert.strictEqual(path.basename(second), 'OS_Ford-V-Ferrari_720p_en2.srt');
    assert.strictEqual(fs.readFileSync(first, 'utf8'), SRT);
});

test('counts across sources and only within one language', () => {
    // The count answers "how many English subtitles do I have for this film",
    // which is a question about the film, not about who supplied them.
    const video = scratch('Ford.V.Ferrari.2019.720p.mkv');
    const dir = path.dirname(video);

    fs.writeFileSync(path.join(dir, 'OS_Ford-V-Ferrari_720p_en1.srt'), SRT);
    fs.writeFileSync(path.join(dir, 'SD_Ford-V-Ferrari_720p_en2.vtt'), SRT);

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'en', 'srt')),
        'OS_Ford-V-Ferrari_720p_en3.srt'
    );
    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'fr', 'srt')),
        'OS_Ford-V-Ferrari_720p_fr1.srt'
    );
});

test('reuses no number after a deletion in the middle', () => {
    // Counting entries would hand out 2 again and collide with the file at 3.
    const video = scratch('Movie.720p.mkv');
    const dir = path.dirname(video);

    fs.writeFileSync(path.join(dir, 'OS_Movie_720p_en1.srt'), SRT);
    fs.writeFileSync(path.join(dir, 'OS_Movie_720p_en3.srt'), SRT);

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'en', 'srt')),
        'OS_Movie_720p_en4.srt'
    );
});

test('gives each episode in a folder its own name and its own counter', () => {
    // Without the episode marker every episode of a season would share a slug,
    // so episode 2's first subtitle would be numbered after episode 1's.
    const video = scratch('Au Service De La France S01E02.mkv');
    const dir = path.dirname(video);

    fs.writeFileSync(path.join(dir, 'OS_Au-Service-De-La-France-S01E01_fr1.srt'), SRT);

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'fr', 'srt')),
        'OS_Au-Service-De-La-France-S01E02_fr1.srt'
    );
});

test('ignores subtitle files the user brought themselves', () => {
    // A hand-placed "Movie.en.srt" is not something this app can count, and must
    // not stop it saving.
    const video = scratch('Movie.mkv');
    fs.writeFileSync(path.join(path.dirname(video), 'Movie.en.srt'), SRT);

    assert.strictEqual(
        path.basename(freeTargetPath(video, 'opensubtitles', 'en', 'srt')),
        'OS_Movie_en1.srt'
    );
});

test('writes the file it named', async () => {
    // freeTargetPath is pure enough to test alone; this pins that saveSubtitle
    // actually routes through it rather than growing a second scheme.
    const video = scratch('Movie.1080p.mkv');
    process.env.MEDIA_DIR = path.dirname(video);
    delete require.cache[require.resolve('../mediaPath')];
    delete require.cache[require.resolve('./store')];
    const { saveSubtitle } = require('./store');

    const saved = await saveSubtitle({
        videoRelPath: 'Movie.1080p.mkv',
        language: 'en',
        buffer: Buffer.from(SRT, 'utf8'),
        provider: 'opensubtitles',
    });

    assert.strictEqual(saved.name, 'OS_Movie_1080p_en1.srt');
    assert.ok(fs.existsSync(path.join(path.dirname(video), saved.name)));
});

test('refuses to save a subtitle for a video that is not there', async () => {
    // The video is the one thing that names a destination, so it has to exist -
    // and be a video, not whatever else sits in the folder.
    const video = scratch('Real.Film.2019.mkv');
    const dir = path.dirname(video);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a video');
    process.env.MEDIA_DIR = dir;
    delete require.cache[require.resolve('../mediaPath')];
    delete require.cache[require.resolve('./store')];
    const { saveSubtitle } = require('./store');

    for (const videoRelPath of ['No.Such.Film.2019.mkv', 'notes.txt']) {
        await assert.rejects(
            saveSubtitle({ videoRelPath, language: 'en', buffer: Buffer.from(SRT, 'utf8'), provider: 'subscene' }),
            (e) => e.status === 404
        );
    }
    assert.deepStrictEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.srt')), []);
});
