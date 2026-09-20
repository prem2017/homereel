const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { isZip, isCandidateEntry, listSubtitleEntries, extractEntry } = require('./archive');

/**
 * A ZIP with stored (uncompressed) entries, built by hand.
 *
 * Node ships a reader but no writer, and one test fixture is not worth a
 * dependency in a workspace that deliberately has no test framework either.
 */
const zipOf = (entries) => {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const [name, content] of entries) {
        const nameBytes = Buffer.from(name, 'utf8');
        const data = Buffer.from(content, 'utf8');
        const crc = zlib.crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);

        const head = Buffer.alloc(46);
        head.writeUInt32LE(0x02014b50, 0);
        head.writeUInt16LE(20, 6);
        head.writeUInt32LE(crc, 16);
        head.writeUInt32LE(data.length, 20);
        head.writeUInt32LE(data.length, 24);
        head.writeUInt16LE(nameBytes.length, 28);
        head.writeUInt32LE(offset, 42);

        locals.push(local, nameBytes, data);
        central.push(head, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }

    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, directory, end]);
};

const SEASON_PACK = [
    ['Show.S01E01.FRENCH.srt', '1\n00:00:01,000 --> 00:00:04,000\nEpisode one.\n'],
    ['Show.S01E02.FRENCH.srt', '1\n00:00:01,000 --> 00:00:04,000\nEpisode two.\n'],
    ['poster.jpg', 'not a subtitle'],
];

test('sniffs a ZIP by signature rather than trusting Content-Type', () => {
    // Providers are inconsistent about the header, so the bytes decide. The
    // OpenSubtitles download endpoint returns a bare .srt; everything else zips.
    assert.strictEqual(isZip(Buffer.from('PK\x03\x04rest of an archive')), true);
    assert.strictEqual(isZip(Buffer.from('1\n00:00:01,000 --> 00:00:04,000\n')), false);
    assert.strictEqual(isZip(Buffer.alloc(0)), false);
});

test('picks subtitle entries and ignores the padding archives come with', () => {
    assert.ok(isCandidateEntry('Movie.2019.en.srt'));
    assert.ok(isCandidateEntry('subs/Movie.VTT'));

    for (const junk of ['readme.nfo', 'poster.jpg', 'sample.mkv', 'subs/']) {
        assert.strictEqual(isCandidateEntry(junk), false, `should ignore ${junk}`);
    }
});

test('ignores the metadata folder macOS staples into archives', () => {
    // Without this the extracted "subtitle" is a resource fork, which decodes to
    // gibberish and fails validation for a reason nobody could guess.
    assert.strictEqual(isCandidateEntry('__MACOSX/._Movie.en.srt'), false);
});

test('does not treat a format the player cannot render as a subtitle', () => {
    // Pulling an .ass out would move the failure to the parser, where the cause
    // is far less obvious than "no usable subtitle in this archive".
    assert.strictEqual(isCandidateEntry('Movie.ass'), false);
    assert.strictEqual(isCandidateEntry('Movie.sub'), false);
});

test('an entry name can never be used as a destination path', () => {
    // Zip slip: these are legal entry names. They are allowed to be *selected* -
    // the defence is that extractEntry returns bytes only, and store.js builds
    // the destination from the video file, so an entry name has nothing to steer.
    assert.ok(isCandidateEntry('../../../etc/evil.srt'));
});

test('lists every subtitle in a season pack, not just the first', async () => {
    // One id can be a whole season. Returning only the first entry is how the
    // wrong episode ends up saved under the right name.
    const names = await listSubtitleEntries(zipOf(SEASON_PACK));
    assert.deepStrictEqual(names, ['Show.S01E01.FRENCH.srt', 'Show.S01E02.FRENCH.srt']);
});

test('reads the entry it was asked for', async () => {
    const zip = zipOf(SEASON_PACK);
    const bytes = await extractEntry(zip, 'Show.S01E02.FRENCH.srt', 1e6);
    assert.ok(bytes.toString('utf8').includes('Episode two.'));

    assert.strictEqual(await extractEntry(zip, 'Show.S01E09.srt', 1e6), null);
});

test('stops inflating an entry that runs past the cap', async () => {
    // Counted as it arrives rather than checked afterwards - checking after means
    // already holding whatever a zip bomb decided to send.
    await assert.rejects(
        extractEntry(zipOf(SEASON_PACK), 'Show.S01E01.FRENCH.srt', 8),
        /exceeded 8 bytes/
    );
});
