const test = require('node:test');
const assert = require('node:assert');
const { detectLanguage, parseLanguages } = require('./languages');

/**
 * Reading a language off what was actually downloaded.
 *
 * This exists because a subtitle fetched by id has a language of its own. The
 * user picked a specific file on the provider's site; the menu in this app had
 * no say in it, and saving a French pack as "_en1.srt" because English happened
 * to be selected would put a lie into the only record this app keeps.
 */
test('reads the language a provider states on its page', () => {
    assert.strictEqual(detectLanguage('French'), 'fr');
    assert.strictEqual(detectLanguage('Le.Bureau.S01E05.RERiP.FRENCH.WEBRip.srt'), 'fr');
    assert.strictEqual(detectLanguage('le-bureau-season-one_HI_french-1863000.zip'), 'fr');
});

test('does not read "_HI_" in a filename as Hindi', () => {
    // It means hearing-impaired. Codes are never matched, only names - which is
    // the whole reason this scans for words like "hindi" and not for "hi".
    assert.strictEqual(detectLanguage('Show.S01E01_HI_english.srt'), 'en');
    assert.strictEqual(detectLanguage('Show.HI.srt'), null);
});

test('matches whole words, so a release group cannot answer for the language', () => {
    assert.strictEqual(detectLanguage('Movie.2019.BluRay-ITALIANOTGROUP'), null);
    assert.strictEqual(detectLanguage('Movie.2019.BluRay.ITALIANO-TGROUP'), 'it');
});

test('knows the compound names the sites actually use', () => {
    assert.strictEqual(detectLanguage('Farsi/Persian'), 'fa');
    assert.strictEqual(detectLanguage('Brazillian Portuguese'), 'pt');
    assert.strictEqual(detectLanguage('Big 5 code'), null);
});

test('says nothing rather than guessing', () => {
    // Nothing is better than wrong here: the caller falls back to what was asked
    // for, and only then to "un" (undetermined).
    assert.strictEqual(detectLanguage('Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS.srt'), null);
    assert.strictEqual(detectLanguage(''), null);
    assert.strictEqual(detectLanguage(undefined), null);
});

test('the offered list still falls back to the defaults when .env is unusable', () => {
    // Pinned here because detectLanguage now shares this module's table.
    assert.deepStrictEqual(parseLanguages('  ').codes[0], 'en');
    assert.ok(parseLanguages('en,zz9').warnings.length > 0);
});
