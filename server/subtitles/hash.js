const fsp = require('fs/promises');

/**
 * OpenSubtitles' "moviehash" (also called OSHash): the file size plus a 64-bit
 * sum of the first and last 64 KB, with every addition wrapping at 64 bits.
 *
 * It exists because hashing a 20 GB film to identify it would be absurd - this
 * reads 128 KB. It is also worth far more than a filename match: a hash hit
 * means the subtitle was timed against *this exact release*, so it is in sync.
 * A title match is only a guess about which rip you have, and a subtitle that is
 * two seconds out is worse than no subtitle at all.
 */
const CHUNK = 65536;
const MASK = 0xffffffffffffffffn;

// The algorithm's stated minimum. Below two chunks the head and tail would
// overlap, so the hash is undefined - no video file is anywhere near this small.
const MIN_SIZE = CHUNK * 2;

// Little-endian uint64 values, unsigned 64-bit arithmetic with natural overflow.
const addChunk = (buf, hash) => {
    for (let i = 0; i + 8 <= buf.length; i += 8) {
        hash = (hash + buf.readBigUInt64LE(i)) & MASK;
    }
    return hash;
};

/**
 * Hash the file at `filePath`, or null if it is too small to hash.
 * Returns the lower-case 16-digit hex string the API expects.
 */
const movieHash = async (filePath) => {
    const { size } = await fsp.stat(filePath);
    if (size < MIN_SIZE) return null;

    const file = await fsp.open(filePath, 'r');
    try {
        const head = Buffer.alloc(CHUNK);
        const tail = Buffer.alloc(CHUNK);
        await file.read(head, 0, CHUNK, 0);
        await file.read(tail, 0, CHUNK, size - CHUNK);

        const hash = addChunk(tail, addChunk(head, BigInt(size) & MASK));
        return hash.toString(16).padStart(16, '0');
    } finally {
        await file.close();
    }
};

module.exports = { movieHash, MIN_SIZE, CHUNK };
