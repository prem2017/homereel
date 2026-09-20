const test = require('node:test');
const assert = require('node:assert');
const { Keyring, parseKeys, RETRY_AFTER_MS } = require('./keyring');

const fails = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** A clock the test moves by hand, so nothing here waits on real time. */
const fakeClock = (start = 1_700_000_000_000) => {
    let t = start;
    const now = () => t;
    now.advance = (ms) => { t += ms; };
    return now;
};

test('one key behaves exactly as a single key always did', async () => {
    // The setting is backward compatible: everyone with one key must see no
    // change in behaviour from this feature existing.
    const keyring = new Keyring(parseKeys('solo'));
    const seen = [];

    const { value } = await keyring.run(async (key) => {
        seen.push(key);
        return 'ok';
    });

    assert.strictEqual(value, 'ok');
    assert.deepStrictEqual(seen, ['solo']);
});

test('a key that is out of downloads hands over to the next one', async () => {
    // The whole point of the feature: the household pools its daily allowances.
    const keyring = new Keyring(parseKeys('a, b'));
    const tried = [];

    const { value, entry } = await keyring.run(async (key) => {
        tried.push(key);
        if (key === 'a') throw fails(406);
        return 'subtitle';
    });

    assert.deepStrictEqual(tried, ['a', 'b']);
    assert.strictEqual(value, 'subtitle');
    assert.strictEqual(entry.label, 'key 2 of 2');
});

test('a spent key is not tried again until the provider resets it', async () => {
    // Without this, every download re-discovers the exhausted key by spending a
    // round trip on it first.
    const now = fakeClock();
    const keyring = new Keyring(parseKeys('a,b'), now);

    await keyring.run(async (key) => {
        if (key === 'a') throw fails(406);
        return 'first';
    });

    const tried = [];
    await keyring.run(async (key) => { tried.push(key); return 'second'; });
    assert.deepStrictEqual(tried, ['b'], 'the spent key should be skipped outright');

    now.advance(RETRY_AFTER_MS + 1);
    const later = [];
    await keyring.run(async (key) => { later.push(key); return 'third'; });
    assert.deepStrictEqual(later, ['a'], 'and come back once its counter has reset');
});

test('a rejected key is dropped, not merely rested', async () => {
    const now = fakeClock();
    const keyring = new Keyring(parseKeys('bad,good'), now);

    await keyring.run(async (key) => {
        if (key === 'bad') throw fails(401);
        return 'ok';
    });

    now.advance(RETRY_AFTER_MS * 24);
    const tried = [];
    await keyring.run(async (key) => { tried.push(key); return 'ok'; });
    assert.deepStrictEqual(tried, ['good'], 'a wrong key never becomes right by waiting');
});

test('an unrelated failure does not burn the rest of the pool', async () => {
    // A 500 or a timeout at the provider says nothing about the keys. Rotating on
    // it would mark every key in the house unusable over one bad afternoon.
    const keyring = new Keyring(parseKeys('a,b,c'));
    let calls = 0;

    await assert.rejects(
        keyring.run(async () => { calls += 1; throw fails(500); }),
        /HTTP 500/,
    );

    assert.strictEqual(calls, 1, 'it must stop at the first key');
    assert.strictEqual(keyring.usable(true).length, 3, 'and leave all three usable');
});

test('search still works when every key is out of downloads', async () => {
    // Searching is unmetered. If a spent key blocked it too, the candidate list
    // would vanish at exactly the moment the user needs to see what was on offer.
    const keyring = new Keyring(parseKeys('a,b'));

    await assert.rejects(keyring.run(async () => { throw fails(406); }));

    await assert.rejects(
        keyring.run(async () => 'metered', { metered: true }),
        /2 of 2 out of downloads for today/,
    );

    const { value } = await keyring.run(async () => 'candidates', { metered: false });
    assert.strictEqual(value, 'candidates');
});

test('the same key pasted twice is not twice the quota', async () => {
    assert.deepStrictEqual(parseKeys(' abc , abc ,def,'), ['abc', 'def']);
    assert.deepStrictEqual(parseKeys(''), []);
    assert.deepStrictEqual(parseKeys(undefined), []);
});

test('a reported remaining of zero retires the key without waiting for a 406', async () => {
    const now = fakeClock();
    const keyring = new Keyring(parseKeys('a,b'), now);
    const reset = new Date(now() + 5 * 60 * 60 * 1000).toISOString();

    const { entry } = await keyring.run(async () => 'ok');
    keyring.note(entry, { remaining: 0, resetIso: reset });

    assert.strictEqual(keyring.usable(true).length, 1);
    now.advance(RETRY_AFTER_MS);
    assert.strictEqual(keyring.usable(true).length, 1, 'the provider reset time is honoured over the default');
});
