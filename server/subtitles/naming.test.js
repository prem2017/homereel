const test = require('node:test');
const assert = require('node:assert');
const {
    parseVideoName, rankCandidates, videoSlug, subtitleFileName, parseSubtitleFileName,
} = require('./naming');

test('pulls title and year out of a release name', () => {
    const video = parseVideoName('Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.mkv');
    assert.strictEqual(video.title, 'Ford V Ferrari');
    assert.strictEqual(video.year, 2019);
    assert.strictEqual(video.season, null);
});

test('pulls season and episode out of a TV release name', () => {
    const video = parseVideoName('Black Mirror S01E02 1080p WEB-DL.mkv');
    assert.strictEqual(video.title, 'Black Mirror');
    assert.strictEqual(video.season, 1);
    assert.strictEqual(video.episode, 2);
});

test('falls back to the bare filename when there is nothing to parse', () => {
    const video = parseVideoName('holiday video.mp4');
    assert.strictEqual(video.title, 'holiday video');
    assert.strictEqual(video.year, null);
});

const candidate = (over) => ({
    provider: 'subdl', release: '', downloads: 0, hashMatch: false, ...over,
});

test('a hash match outranks everything, whoever supplied it', () => {
    // The rule that matters: a hash match is timed against this exact file, so a
    // title guess from a preferred provider must not displace it.
    const video = parseVideoName('Movie.2019.1080p.mkv');
    const ranked = rankCandidates([
        candidate({ provider: 'subdl', release: 'Movie.2019.1080p', downloads: 9999 }),
        candidate({ provider: 'opensubtitles', hashMatch: true, downloads: 1 }),
    ], video, ['subdl', 'opensubtitles']);

    assert.strictEqual(ranked[0].provider, 'opensubtitles');
    assert.strictEqual(ranked[0].tier, 0);
});

test('an exact release match outranks a bare title match', () => {
    const video = parseVideoName('Movie.2019.1080p.BluRay-SPARKS.mkv');
    const ranked = rankCandidates([
        candidate({ release: 'Movie.2019.720p.WEB' }),
        candidate({ release: 'movie 2019 1080p bluray sparks' }), // same, punctuated differently
    ], video, ['subdl']);

    assert.strictEqual(ranked[0].tier, 1);
    assert.strictEqual(ranked[1].tier, 2);
});

test('configured provider order breaks ties within a tier', () => {
    const video = parseVideoName('Movie.2019.mkv');
    const ranked = rankCandidates([
        candidate({ provider: 'subdl' }),
        candidate({ provider: 'opensubtitles' }),
    ], video, ['opensubtitles', 'subdl']);

    assert.deepStrictEqual(ranked.map((c) => c.provider), ['opensubtitles', 'subdl']);
});

test('preferring a provider still cannot promote it past a better match', () => {
    // The pushback made concrete: sub-scene first in the list, but a hash match
    // elsewhere still wins.
    const video = parseVideoName('Movie.2019.mkv');
    const ranked = rankCandidates([
        candidate({ provider: 'subdl' }),
        candidate({ provider: 'opensubtitles', hashMatch: true }),
    ], video, ['subdl', 'opensubtitles']);

    assert.strictEqual(ranked[0].provider, 'opensubtitles');
});

// ---------------------------------------------------------------------------
// Saved-subtitle names
// ---------------------------------------------------------------------------

test('builds a name from the video, not from the release string', () => {
    const video = parseVideoName('Ford.V.Ferrari.2019.720p.BluRay.x264-SPARKS.mkv');

    assert.strictEqual(
        subtitleFileName({ provider: 'opensubtitles', video, language: 'en', counter: 1, extension: 'srt' }),
        'OS_Ford-V-Ferrari_720p_en1.srt'
    );
});

test('the video slug carries the episode but never an underscore', () => {
    // "_" is the field separator, so one inside a slug would make the name
    // unreadable. Season folders need the episode or every episode shares a name.
    assert.strictEqual(videoSlug(parseVideoName('Au_Service_De_La_France_S01E01.mkv')),
        'Au-Service-De-La-France-S01E01');
    assert.ok(!videoSlug(parseVideoName('Some_Movie_Name.mkv')).includes('_'));
});

test('falls back to the file name when nothing parses out of it', () => {
    assert.ok(videoSlug(parseVideoName('...mkv')).length > 0);
});

test('reads its own names back', () => {
    assert.deepStrictEqual(parseSubtitleFileName('OS_Ford-V-Ferrari_720p_en1.srt'), {
        provider: 'OS',
        video: 'Ford-V-Ferrari',
        resolution: '720p',
        language: 'en',
        counter: 1,
        extension: 'srt',
    });

    // Same name minus the optional resolution segment.
    assert.deepStrictEqual(parseSubtitleFileName('SD_Holiday-in-Rome_fr12.vtt'), {
        provider: 'SD',
        video: 'Holiday-in-Rome',
        resolution: null,
        language: 'fr',
        counter: 12,
        extension: 'vtt',
    });
});

test('every generated name reads back to what generated it', () => {
    const names = [
        'Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.mkv',
        'Au Service De La France S01E01.mp4',
        'holiday video.avi',
        'The Matrix (1999) 720p.mkv',
    ];

    for (const fileName of names) {
        const video = parseVideoName(fileName);
        for (const provider of ['opensubtitles', 'subdl']) {
            const name = subtitleFileName({ provider, video, language: 'pt', counter: 7, extension: 'vtt' });
            const parsed = parseSubtitleFileName(name);
            assert.ok(parsed, `${name} did not read back`);
            assert.strictEqual(parsed.video, videoSlug(video), name);
            assert.strictEqual(parsed.resolution, video.resolution, name);
            assert.strictEqual(parsed.language, 'pt', name);
            assert.strictEqual(parsed.counter, 7, name);
        }
    }
});

test('does not claim a subtitle the user placed themselves', () => {
    // These must read as "not ours" so they are never counted, and so a hand-made
    // file is never mistaken for a download.
    for (const name of ['Movie.en.srt', 'Movie.srt', 'subtitles.vtt', 'OS_Movie_en1.txt']) {
        assert.strictEqual(parseSubtitleFileName(name), null, name);
    }
});
