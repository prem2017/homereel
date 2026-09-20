const test = require('node:test');
const assert = require('node:assert');

/**
 * Which sources SUBTITLE_PROVIDERS governs, and which it does not.
 *
 * It governs the ones that can be *searched*. Subscene cannot be - its search
 * page is behind a bot check - so it never produces a candidate for that setting
 * to rank, and being on the list only ever meant "may the ID box work": a switch
 * nothing in the setting's name or its documentation would lead anyone to look
 * for. Writing the list out by hand, which .env.example invites, therefore
 * removed a control that stayed on screen and failed with a message naming
 * nothing. It is a source of its own now, switched by SUBSCENE_URL alone.
 *
 * Config is read once at require time, so each case gets a fresh module - the
 * same pattern subscene.test.js uses.
 */
const SETTINGS = [
    'SUBTITLE_PROVIDERS', 'SUBSCENE_URL', 'SUBSCENE_BASE_URL',
    'OPENSUBTITLES_API_KEY', 'SUBDL_API_KEY',
];

const load = (env) => {
    for (const key of SETTINGS) {
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
    }
    for (const module of ['../config', './subscene', './opensubtitles', './subdl', './index']) {
        delete require.cache[require.resolve(module)];
    }
    return require('./index');
};

test('an address is the whole of Subscene\'s configuration', () => {
    // The reported bug: this exact SUBTITLE_PROVIDERS line, a valid id, and a
    // refusal. The list has nothing to say about this source now.
    const { providerStatus } = load({
        SUBTITLE_PROVIDERS: 'opensubtitles,subdl',
        SUBSCENE_URL: 'https://sub-scene.com',
    });

    assert.strictEqual(providerStatus('subscene').ok, true);
});

test('and an empty address is what turns it off, naming the setting', () => {
    const { providerStatus } = load({ SUBTITLE_PROVIDERS: '', SUBSCENE_URL: '' });
    const status = providerStatus('subscene');

    assert.strictEqual(status.ok, false);
    assert.match(status.reason, /SUBSCENE_URL/);
    assert.doesNotMatch(status.reason, /SUBTITLE_PROVIDERS/);
});

test('it is on with no configuration at all', () => {
    // Nobody should have to configure anything to use the source that needs no
    // account, so an unset address means the built-in one.
    const { providerStatus } = load({ SUBTITLE_PROVIDERS: undefined, SUBSCENE_URL: undefined });

    assert.strictEqual(providerStatus('subscene').ok, true);
});

test('the name it used to have still works, so an existing .env does not break', () => {
    const { providerStatus } = load({
        SUBTITLE_PROVIDERS: undefined,
        SUBSCENE_URL: undefined,
        SUBSCENE_BASE_URL: '',
    });

    assert.strictEqual(providerStatus('subscene').ok, false);
    assert.strictEqual(require('../config').subsceneUrl, '');
});

test('SUBTITLE_PROVIDERS still selects and orders the searchable sources', () => {
    const { resolveProviders } = load({
        SUBTITLE_PROVIDERS: 'subdl,opensubtitles',
        SUBDL_API_KEY: 'k1',
        OPENSUBTITLES_API_KEY: 'k2',
    });

    assert.deepStrictEqual(
        resolveProviders().active.map((p) => p.name),
        ['subdl', 'opensubtitles']
    );
});

test('Subscene never joins the searched sources, listed or not', () => {
    // It would only ever contribute an empty result, and appearing in `providers`
    // would tell the UI it had a menu entry to offer.
    const { resolveProviders } = load({
        SUBTITLE_PROVIDERS: 'subscene',
        SUBSCENE_URL: 'https://sub-scene.com',
    });
    const { active, problems } = resolveProviders();

    assert.deepStrictEqual(active, []);
    // Silently, too: it is switched on elsewhere, so this is not a disabled
    // source needing an explanation - and `problems` is flashed after every
    // search, where a leftover line would nag forever.
    assert.deepStrictEqual(problems, []);
});

test('a name this app has never heard of is still reported', () => {
    const { resolveProviders, providerStatus } = load({ SUBTITLE_PROVIDERS: 'opensubtitles,nope' });

    assert.deepStrictEqual(
        resolveProviders().problems.map((p) => p.name).filter((n) => n === 'nope'),
        ['nope']
    );

    const status = providerStatus('definitely-not-a-provider');
    assert.strictEqual(status.ok, false);
    // Not echoed back: it came from the client, which already knows what it sent.
    assert.doesNotMatch(status.reason, /definitely-not-a-provider/);
});

test('a searchable source left off the list is still switched off by it', () => {
    const { providerStatus } = load({
        SUBTITLE_PROVIDERS: 'subdl',
        OPENSUBTITLES_API_KEY: 'k',
    });
    const status = providerStatus('opensubtitles');

    assert.strictEqual(status.ok, false);
    assert.match(status.reason, /SUBTITLE_PROVIDERS/);
});
