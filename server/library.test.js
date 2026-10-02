const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// MEDIA_DIR is read once, when mediaPath.js loads.
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'library-'));
process.env.MEDIA_DIR = MEDIA;
const { describeMedia, getFileTree, libraryTree, forgetLibrary } = require('./library');

const put = (relPath, content = '') => {
    const target = path.join(MEDIA, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
};

test('reads an episode, keeping its own title and leaving release tokens out', () => {
    assert.deepStrictEqual(describeMedia('Le.Bureau.des.Legendes.S01E02.1080p.mp4', 'video/mp4'),
        { title: 'Le Bureau des Legendes', season: 1, episode: 2, resolution: '1080p' });
    assert.strictEqual(describeMedia('Show.S01E01.Pilot.720p.mkv', 'video/x-matroska').episodeTitle, 'Pilot');
    assert.strictEqual(describeMedia('The Wire S03E07 Back Burners.mkv', 'video/x-matroska').episodeTitle, 'Back Burners');
    assert.strictEqual(describeMedia('Dark.Matter.S01E02.720p.WEB.mp4', 'video/mp4').episodeTitle, undefined);
});

test('reads a film: title, year, resolution, source and codec', () => {
    assert.deepStrictEqual(describeMedia('Big.Buck.Bunny.2008.1080p.BluRay.x264.mp4', 'video/mp4'),
        { title: 'Big Buck Bunny', year: 2008, resolution: '1080p', source: 'bluray', codec: 'x264' });
    assert.strictEqual(describeMedia('Tears.of.Steel.2012.2160p.HEVC.mp4', 'video/mp4').codec, 'h265');
    assert.deepStrictEqual(describeMedia('Les Misérables (2012).mp4', 'video/mp4'), { title: 'Les Misérables', year: 2012 });
});

test('reads a song as a track number and a title, not as a release', () => {
    assert.deepStrictEqual(describeMedia('01 - Nocturne in E-flat major.flac', 'audio/flac'),
        { title: 'Nocturne in E-flat major', track: 1 });
    assert.deepStrictEqual(describeMedia('Chanson.flac', 'audio/flac'), { title: 'Chanson' });
});

test('lists size, date, what a name says, and the artwork beside it', () => {
    put('Films/Sintel (2010)/Sintel.2010.720p.mp4', 'abc');
    put('Films/Sintel (2010)/poster.jpg');
    put('Films/Sintel (2010)/Sintel.2010.720p.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    put('Films/Big.Buck.Bunny.2008.mp4');
    put('Films/Big.Buck.Bunny.2008-poster.png');

    const films = getFileTree(MEDIA).find((n) => n.name === 'Films');
    const sintelFolder = films.children.find((n) => n.name === 'Sintel (2010)');
    const sintel = sintelFolder.children.find((n) => n.name === 'Sintel.2010.720p.mp4');
    const bunny = films.children.find((n) => n.name === 'Big.Buck.Bunny.2008.mp4');

    assert.strictEqual(sintelFolder.art, 'Films/Sintel (2010)/poster.jpg');
    assert.strictEqual(sintel.size, 3);
    assert.ok(sintel.mtime > 0);
    assert.deepStrictEqual(sintel.info, { title: 'Sintel', year: 2010, resolution: '720p' });
    assert.strictEqual(bunny.art, 'Films/Big.Buck.Bunny.2008-poster.png');
    // Only media is described; a subtitle is listed as it always was.
    assert.strictEqual(sintelFolder.children.find((n) => n.name.endsWith('.srt')).info, undefined);
});

test('answers from the last scan until asked to look again', () => {
    forgetLibrary();
    const first = libraryTree();
    put('Later/New.mp4');
    assert.strictEqual(libraryTree(), first, 'a second call reuses the scan');

    const fresh = libraryTree({ fresh: true });
    assert.notStrictEqual(fresh, first);
    assert.ok(fresh.some((n) => n.name === 'Later'));

    put('Later/Newer.mp4');
    forgetLibrary();
    assert.ok(libraryTree().find((n) => n.name === 'Later').children.some((n) => n.name === 'Newer.mp4'));
});
