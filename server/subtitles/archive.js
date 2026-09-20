const yauzl = require('yauzl');

/**
 * Pull the subtitle out of a downloaded ZIP.
 *
 * Everything except the OpenSubtitles download endpoint hands back an archive,
 * and the media folder is now writable, so a hostile archive would be a write
 * primitive into someone's film collection. Three specific hazards:
 *
 *   - zip slip: an entry named "../../.bashrc" escaping wherever we extract to.
 *   - zip bombs: a few KB inflating into gigabytes.
 *   - junk: archives padded with .nfo, .jpg, sample clips and adverts.
 *
 * The defence is to trust the archive for nothing structural. Entry names are
 * read only to *choose* an entry, never to place one - the path we save to is
 * derived from the video file (see store.js) - and inflation is counted as it
 * happens, against a cap, rather than after the fact.
 *
 * Only .srt and .vtt are looked for. The player renders those two and nothing
 * else, so pulling out an .ass would just move the failure somewhere less
 * explicable than "this provider had no usable subtitle file".
 */
const SUBTITLE_ENTRY = /\.(srt|vtt)$/i;

const isCandidateEntry = (name) => {
    // Directory entries and the junk macOS staples into archives.
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) return false;
    return SUBTITLE_ENTRY.test(name);
};

const readEntry = (zip, entry, maxBytes) => new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);

        const chunks = [];
        let total = 0;
        stream.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                // Destroying the stream stops the inflater, which is the point:
                // checking the size afterwards would mean already holding it.
                stream.destroy();
                reject(new Error(`Subtitle entry exceeded ${maxBytes} bytes.`));
                return;
            }
            chunks.push(chunk);
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
});

/**
 * Every subtitle entry name in the archive, in the order it lists them.
 *
 * Listing and reading are two calls because one archive can hold a whole season -
 * sub-scene.com/subtitle/1863000 is ten episodes in one ZIP - and taking the
 * first entry there means saving episode 1 while episode 5 is playing. The names
 * are the only thing that says which is which, so the caller gets them all and
 * decides (see index.js). They are still read only to *choose*: nothing is ever
 * placed by an entry name.
 *
 * `buffer` is assumed to be a ZIP; callers check the signature first.
 */
const listSubtitleEntries = (buffer) => new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);

        const names = [];
        zip.on('entry', (entry) => {
            if (isCandidateEntry(entry.fileName)) names.push(entry.fileName);
            zip.readEntry();
        });
        zip.on('end', () => resolve(names));
        zip.on('error', reject);
        zip.readEntry();
    });
});

/**
 * The bytes of one named entry, or null if the archive has no such entry.
 *
 * One at a time and capped, so a ten-episode pack costs one entry of memory
 * rather than ten.
 */
const extractEntry = (buffer, entryName, maxBytes) => new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);

        zip.on('entry', (entry) => {
            if (entry.fileName !== entryName) return zip.readEntry();
            readEntry(zip, entry, maxBytes).then(resolve, reject);
        });
        zip.on('end', () => resolve(null));
        zip.on('error', reject);
        zip.readEntry();
    });
});

// "PK\x03\x04". Providers are inconsistent about Content-Type, so sniff instead.
const isZip = (buffer) => buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;

module.exports = { listSubtitleEntries, extractEntry, isZip, isCandidateEntry };
