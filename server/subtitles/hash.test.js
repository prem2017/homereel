const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { movieHash, MIN_SIZE, CHUNK } = require('./hash');

const tmpFile = (name, buffer) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oshash-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, buffer);
    return file;
};

test('a file of zeros hashes to its own size', async () => {
    // Every 64-bit word added is zero, so the hash is the seed: the file size.
    // 131072 = 0x20000, which makes this checkable by eye.
    const file = tmpFile('zeros.bin', Buffer.alloc(MIN_SIZE));
    assert.strictEqual(await movieHash(file), '0000000000020000');
});

test('head and tail both contribute to the hash', async () => {
    // Two files of identical size differing only in their last byte must not
    // collide - if the tail were dropped, they would.
    const a = Buffer.alloc(MIN_SIZE);
    const b = Buffer.alloc(MIN_SIZE);
    b[MIN_SIZE - 1] = 1;

    const hashA = await movieHash(tmpFile('a.bin', a));
    const hashB = await movieHash(tmpFile('b.bin', b));
    assert.notStrictEqual(hashA, hashB);
});

test('sums little-endian 64-bit words with wraparound', async () => {
    // One word set to 0xFFFFFFFFFFFFFFFF in the head. Adding it to the size seed
    // wraps: (0x20000 + 0xFFFFFFFFFFFFFFFF) mod 2^64 = 0x1FFFF.
    const buffer = Buffer.alloc(MIN_SIZE);
    buffer.writeBigUInt64LE(0xffffffffffffffffn, 0);

    assert.strictEqual(await movieHash(tmpFile('wrap.bin', buffer)), '000000000001ffff');
});

test('returns null below the algorithm minimum instead of a wrong hash', async () => {
    // Under two chunks the head and tail overlap and the hash is undefined.
    const file = tmpFile('small.bin', Buffer.alloc(CHUNK));
    assert.strictEqual(await movieHash(file), null);
});
