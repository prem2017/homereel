const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planArchive, episodeKeyOf } = require('./index');

/**
 * Which subtitle out of an archive goes to which video.
 *
 * The case that forced this is real and ordinary: sub-scene.com/subtitle/1863000
 * is one id holding ten episodes of one season. Taking the first entry - which is
 * what "extract the subtitle from the ZIP" means when nobody thinks about packs -
 * saves episode 1 under episode 5's name, which is worse than failing: the file
 * list looks right and the dialogue does not match the picture.
 */
const folderOf = (videos) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subpack-'));
    for (const name of videos) fs.writeFileSync(path.join(dir, name), '');
    return dir;
};

const PACK = [
    'Le.Bureau.Des.Legendes.S01E01.FRENCH.WEBRip.x264-AUTHORiTY.srt',
    'Le.Bureau.Des.Legendes.S01E02.FRENCH.WEBRip.x264-AUTHORiTY.srt',
    'Le.Bureau.Des.Legendes.S01E03.FRENCH.WEBRip.x264-AUTHORiTY.srt',
];

test('reads the episode a name is about, however it is written', () => {
    assert.strictEqual(episodeKeyOf('Show.S01E05.1080p.mkv'), 's1e5');
    assert.strictEqual(episodeKeyOf('subs/Show.1x05.srt'), 's1e5');
    assert.strictEqual(episodeKeyOf('Ford.V.Ferrari.2019.1080p.mkv'), null);
});

test('takes the entry for the episode playing, not the first in the archive', () => {
    const dir = folderOf(['Show.S01E02.mkv']);
    const { mine } = planArchive(PACK, path.join(dir, 'Show.S01E02.mkv'));

    assert.strictEqual(mine, PACK[1]);
});

test('matches the rest of the pack to the videos actually in the folder', () => {
    // One id, one archive already in hand, one press. Episode 3 has no video
    // here, so nothing is written for it.
    const dir = folderOf(['Show.S01E01.mkv', 'Show.S01E02.mkv', 'notes.txt']);
    const { mine, extras } = planArchive(PACK, path.join(dir, 'Show.S01E01.mkv'));

    assert.strictEqual(mine, PACK[0]);
    assert.deepStrictEqual(
        extras.map((e) => [e.entry, path.basename(e.videoAbsPath)]),
        [[PACK[1], 'Show.S01E02.mkv']]
    );
});

test('writes one subtitle per episode even when the archive carries two', () => {
    const dir = folderOf(['Show.S01E01.mkv', 'Show.S01E02.mkv']);
    const twice = [...PACK, 'Show.S01E02.OTHER.GROUP.srt'];
    const { extras } = planArchive(twice, path.join(dir, 'Show.S01E01.mkv'));

    assert.strictEqual(extras.length, 1);
});

test('refuses an archive that does not hold the episode playing, and says what it does hold', () => {
    // The alternative is saving something plausible-looking, which is the bug
    // this whole function exists to prevent.
    const dir = folderOf(['Show.S02E03.mkv']);

    assert.throws(
        () => planArchive(PACK, path.join(dir, 'Show.S02E03.mkv')),
        (e) => e.status === 404 && /S01E01, S01E02, S01E03 - not S02E03/.test(e.message)
    );
});

test('a film takes the first entry, since there is nothing to match on', () => {
    const dir = folderOf(['Ford.V.Ferrari.2019.1080p.mkv']);
    const { mine, extras } = planArchive(['Ford.V.Ferrari.CD1.srt', 'Ford.V.Ferrari.CD2.srt'],
        path.join(dir, 'Ford.V.Ferrari.2019.1080p.mkv'));

    assert.strictEqual(mine, 'Ford.V.Ferrari.CD1.srt');
    assert.deepStrictEqual(extras, []);
});

test('names a long pack as a range rather than a wall of episodes', () => {
    // Ten of these, spelled out, is not a message anyone reads from a sofa.
    const dir = folderOf(['Show.S02E03.mkv']);
    const season = Array.from({ length: 10 }, (_, i) => `Show.S01E${String(i + 1).padStart(2, '0')}.srt`);

    assert.throws(
        () => planArchive(season, path.join(dir, 'Show.S02E03.mkv')),
        /holds S01E01-S01E10 - not S02E03/
    );
});
