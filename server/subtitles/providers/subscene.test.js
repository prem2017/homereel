const test = require('node:test');
const assert = require('node:assert');

process.env.SUBSCENE_URL = 'https://sub-scene.com';
const { findArchiveLink, SAFE_ID, search, configured, languageOfPage } = require('./subscene');

const PAGE = 'https://sub-scene.com/subtitle/2847391';

test('finds the archive link on the page', () => {
    const html = `<html><a class="dl" href="https://res.subscene.best/z/9931.zip">Download</a></html>`;
    assert.strictEqual(findArchiveLink(html, PAGE), 'https://res.subscene.best/z/9931.zip');
});

test('finds a link written relative to the page', () => {
    const html = `<a href="/downloads/9931.zip">Download</a>`;
    assert.strictEqual(findArchiveLink(html, PAGE), 'https://sub-scene.com/downloads/9931.zip');
});

test('refuses a link to any other host', () => {
    // The page is not under anyone's control this app trusts, so a link it
    // carries must not be able to name a destination. This is the check that
    // stops the endpoint being a way to fetch arbitrary URLs from inside the
    // user's network.
    const html = `<a href="https://evil.example/payload.zip">Download</a>`;
    assert.strictEqual(findArchiveLink(html, PAGE), null);
});

test('ignores links that are not a subtitle or an archive', () => {
    const html = `<a href="https://res.subscene.best/tracker.js">x</a><a href="/about">y</a>`;
    assert.strictEqual(findArchiveLink(html, PAGE), null);
});

test('follows the site to a new address given in .env', () => {
    // The site is a clone that has moved once already. Changing SUBSCENE_URL
    // has to move the allowed host with it, or the new address would be fetched
    // and then its own download link refused.
    process.env.SUBSCENE_URL = 'https://sub-scene.example/';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
    const moved = require('./subscene');

    const page = 'https://sub-scene.example/subtitle/2847391';
    const html = `<a href="/downloads/9931.zip">Download</a>`;
    assert.strictEqual(moved.findArchiveLink(html, page), 'https://sub-scene.example/downloads/9931.zip');

    process.env.SUBSCENE_URL = 'https://sub-scene.com';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
});

test('only accepts an id that cannot reshape the URL', () => {
    for (const good of ['2847391', 'abc-123', 'a_b']) assert.ok(SAFE_ID.test(good), good);
    for (const bad of ['../../admin', 'https://evil.example', '12 34', '', 'a/b', '.']) {
        assert.strictEqual(SAFE_ID.test(bad), false, bad);
    }
});

test('never returns candidates, and never fails the search', async () => {
    // Its search path is behind a bot challenge, so there is nothing to return.
    // Throwing here would show the source as unavailable on every single search.
    assert.deepStrictEqual(await search({ video: {}, language: 'en' }), []);
});

test('is on with no configuration at all, and off when blanked', () => {
    assert.strictEqual(configured().ok, true);

    // Unset means "the site's usual address", not "off" - it needs no account,
    // so there is nothing for a user to sign up for before it works.
    delete process.env.SUBSCENE_URL;
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
    assert.strictEqual(require('./subscene').configured().ok, true);
    assert.strictEqual(require('../config').subsceneUrl, 'https://sub-scene.com');

    // Emptying the line in .env is the off switch.
    process.env.SUBSCENE_URL = '';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
    const off = require('./subscene');
    assert.strictEqual(off.configured().ok, false);
    assert.match(off.configured().reason, /SUBSCENE_URL/);
});

test('reads the language off the end of the page title, not out of the film name', () => {
    // The real page for id 1863000. The site states it twice - in the title and
    // in the archive filename - and a subtitle taken by id has a language of its
    // own, so this is what the saved file gets named after rather than whatever
    // was left selected in the menu.
    const page = '<title>Subscene - Le Bureau des Légendes (The Bureau) - First Season - French subtitle</title>';
    const link = 'https://res.subscene.best/file/le-bureau-season-one_HI_french-1863000.zip';

    assert.strictEqual(languageOfPage(page, link), 'fr');

    // A film whose *name* contains a language. Scanning the page for language
    // words would answer "French" here; reading the end of the title answers
    // English, which is what the page says the subtitle is.
    assert.strictEqual(
        languageOfPage('<title>Subscene - The French Connection (1971) - English subtitle</title>', null),
        'en'
    );
});

test('falls back to the archive filename, and then says nothing', () => {
    const link = 'https://res.subscene.best/file/some-show_farsi_persian-2847391.zip';
    assert.strictEqual(languageOfPage('<title>Subscene</title>', link), 'fa');
    assert.strictEqual(languageOfPage('<title>Subscene</title>', 'https://res.subscene.best/file/x-1.zip'), null);
});

test('names what the id will fetch, without the site\'s own prefix', () => {
    // Shown under the box the moment an id checks out. This is the difference
    // between "those digits are well-formed" and "that is the right subtitle" -
    // and the site puts the language in there too, so nothing else is needed.
    const { titleOfPage } = require('./subscene');

    assert.strictEqual(
        titleOfPage('<title>Subscene - Le Bureau des Légendes - First Season - French subtitle</title>'),
        'Le Bureau des Légendes - First Season - French subtitle'
    );
    assert.strictEqual(
        titleOfPage('<title>Subscene - Fast &amp; Furious - English subtitle</title>'),
        'Fast & Furious - English subtitle'
    );
    assert.strictEqual(titleOfPage('<html>no title here</html>'), null);
});

test('a dead domain is told apart from a dead ID, because the fix is different', async () => {
    // The site is a clone that has moved once already, so "the address in .env is
    // stale" is a routine event here rather than an outage - and it is fixed by
    // editing a file, not by typing another number. A check that reported both as
    // "no such id" would send the user hunting for a better id forever.
    process.env.SUBSCENE_URL = 'https://subscene-that-does-not-resolve.invalid';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
    const gone = require('./subscene');

    const result = await gone.check('1863000');

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.unreachable, true);
    assert.match(result.reason, /SUBSCENE_URL/);
    assert.match(result.reason, /subscene-that-does-not-resolve\.invalid/);
});

test('and neither is reported as a crash - the box has somewhere to put both', async () => {
    process.env.SUBSCENE_URL = '';
    delete require.cache[require.resolve('../config')];
    delete require.cache[require.resolve('./subscene')];
    const off = require('./subscene');

    const result = await off.check('1863000');

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.unreachable, false);
    assert.match(result.reason, /SUBSCENE_URL/);
});
