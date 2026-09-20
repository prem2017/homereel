/**
 * The languages offered in the subtitle menus, as ISO 639-1 codes.
 *
 * Deliberately short. This is a dropdown driven by a TV remote from across a
 * room, not a search box - a hundred entries would be unusable. SUBTITLE_LANGUAGES
 * in .env replaces the list wholesale for anyone who needs different ones.
 */
const DEFAULT_CODES = ['en', 'fr', 'es', 'hi', 'ja', 'it', 'ko', 'de', 'pt', 'ar'];

// Display names for the defaults, plus the handful most likely to be added by
// hand. An unknown code still works - it just shows as the code itself.
const NAMES = {
    en: 'English', fr: 'French', es: 'Spanish', hi: 'Hindi', ja: 'Japanese',
    it: 'Italian', ko: 'Korean', de: 'German', pt: 'Portuguese', ar: 'Arabic',
    zh: 'Chinese', ru: 'Russian', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
    sv: 'Swedish', da: 'Danish', fi: 'Finnish', no: 'Norwegian', he: 'Hebrew',
    id: 'Indonesian', th: 'Thai', vi: 'Vietnamese', el: 'Greek', cs: 'Czech',
    ro: 'Romanian', hu: 'Hungarian', uk: 'Ukrainian', fa: 'Persian', ta: 'Tamil',
    te: 'Telugu', bn: 'Bengali', ml: 'Malayalam', mr: 'Marathi', ur: 'Urdu',
};

/**
 * Parse SUBTITLE_LANGUAGES ("en,fr,hi") into the offered list.
 *
 * Env vars are a trust boundary, so anything unusable is dropped and reported
 * rather than passed to a provider - a typo like "HN" for Hindi would otherwise
 * just return no results forever, with nothing to explain why.
 */
const parseLanguages = (raw) => {
    const warnings = [];
    if (!raw || !raw.trim()) return { codes: DEFAULT_CODES, warnings };

    const codes = [];
    for (const token of raw.split(',')) {
        const code = token.trim().toLowerCase();
        if (!code) continue;

        if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)) {
            warnings.push(`SUBTITLE_LANGUAGES: ignoring "${token.trim()}" - not a language code.`);
            continue;
        }
        if (!NAMES[code]) {
            warnings.push(`SUBTITLE_LANGUAGES: "${code}" is not a code this app knows a name for; using it anyway.`);
        }
        if (!codes.includes(code)) codes.push(code);
    }

    if (codes.length === 0) {
        warnings.push('SUBTITLE_LANGUAGES had no usable codes; falling back to the defaults.');
        return { codes: DEFAULT_CODES, warnings };
    }
    return { codes, warnings };
};

const nameOf = (code) => NAMES[code] || code.toUpperCase();

/**
 * Language names as they are actually written on a provider's page, in an
 * archive filename, or in an entry name - "French subtitle",
 * "..._french-1863000.zip", "S01E05.FRENCH.WEBRip.srt".
 *
 * Built from the display names above, plus the endonyms and the compound names
 * the sites use. This exists because a subtitle fetched by id has a language of
 * its own: the user asks for a *specific file*, and what that file is written in
 * is a fact about the file, not a choice in a menu. Reading it here is what keeps
 * a French pack from being saved as "_en1.srt".
 */
const ALIASES = {
    ...Object.fromEntries(Object.entries(NAMES).map(([code, name]) => [name.toLowerCase(), code])),
    farsi: 'fa', persian: 'fa',
    francais: 'fr', castellano: 'es', espanol: 'es', latino: 'es',
    deutsch: 'de', nederlands: 'nl', italiano: 'it',
    portugues: 'pt', brazilian: 'pt', brazillian: 'pt',
    mandarin: 'zh', cantonese: 'zh', bahasa: 'id',
};

/**
 * The first language name appearing in `text`, as a code, or null.
 *
 * Names only, never codes: "_HI_" in a filename means hearing-impaired, and a
 * two-letter scan would read it as Hindi. Word by word rather than by substring
 * for the same reason - "arabic" must not be found inside a release group.
 */
const detectLanguage = (text) => {
    for (const word of String(text || '').toLowerCase().split(/[^a-z]+/)) {
        if (ALIASES[word]) return ALIASES[word];
    }
    return null;
};

module.exports = { DEFAULT_CODES, NAMES, ALIASES, parseLanguages, nameOf, detectLanguage };
