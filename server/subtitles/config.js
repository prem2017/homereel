const { parseLanguages, nameOf } = require('./languages');
const { parseKeys } = require('./keyring');

/**
 * Everything the subtitle feature reads from the environment, resolved once.
 *
 * The whole feature is optional: with no API keys configured the endpoints still
 * answer, they just report that no provider is available. The player then
 * behaves exactly as it did before any of this existed, which is the only
 * acceptable default for a repo strangers clone - nobody should have to register
 * for anything to watch a file off their own disk.
 */
/**
 * The sources SUBTITLE_PROVIDERS selects and orders - which is to say, the ones
 * that can be *searched*.
 *
 * Subscene is deliberately not among them. It has no search at all, so it never
 * produces a candidate for that ordering to rank, and listing it there only ever
 * meant "may the ID box work" - a switch nothing in the setting's name or its
 * documentation would lead anyone to look for. It is configured by SUBSCENE_URL
 * and by nothing else.
 */
const DEFAULT_PROVIDER_ORDER = ['opensubtitles', 'subdl'];

// The clone answering today. A setting rather than a constant because the
// original subscene.com closed in May 2024 and this address may move again -
// but it ships with a working default, because a user who has to look up a URL
// before the feature exists at all will simply not use it.
const DEFAULT_SUBSCENE_URL = 'https://sub-scene.com';

// The API asks callers to identify themselves; a generic agent gets rate-limited
// harder and is against OpenSubtitles' terms.
const DEFAULT_USER_AGENT = 'homereel v1.0.0';

// A subtitle is tens of kilobytes and an archive of one is not much more.
// Anything past this is not a subtitle, whatever the provider claims.
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

const positiveInt = (raw, fallback) => {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const parseProviders = (raw) => {
    if (!raw || !raw.trim()) return DEFAULT_PROVIDER_ORDER;
    const names = raw.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : DEFAULT_PROVIDER_ORDER;
};

// Trailing slashes would double up in "<base>/subtitle/<id>". An unset value
// falls back to the default; an explicitly empty one turns the provider off.
const parseSubsceneUrl = (raw) => (
    raw === undefined ? DEFAULT_SUBSCENE_URL : String(raw).trim().replace(/\/+$/, '')
);

// ponytail: SUBSCENE_BASE_URL was this setting's name for one release
// (ceiling: .env files written before the rename, and the node path only -
// docker/compose.yml passes SUBSCENE_URL alone, so a container falls back to the
// built-in default and then says the address is not answering, which names the
// fix). A silent break would read as "the feature stopped working", so the old
// name is still honoured and says so. Upgrade: delete this and read SUBSCENE_URL
// directly, once no .env in the wild still carries the old name.
const subsceneUrlSetting = () => {
    if (process.env.SUBSCENE_URL !== undefined) return process.env.SUBSCENE_URL;
    if (process.env.SUBSCENE_BASE_URL !== undefined) {
        console.warn('SUBSCENE_BASE_URL in .env is now called SUBSCENE_URL. Still read, for now - please rename it.');
        return process.env.SUBSCENE_BASE_URL;
    }
    return undefined;
};

const { codes: languageCodes, warnings } = parseLanguages(process.env.SUBTITLE_LANGUAGES);

const config = {
    languages: languageCodes.map((code) => ({ code, name: nameOf(code) })),
    providerOrder: parseProviders(process.env.SUBTITLE_PROVIDERS),
    timeoutMs: positiveInt(process.env.SUBTITLE_TIMEOUT_MS, 12000),
    maxDownloadBytes: MAX_DOWNLOAD_BYTES,
    maxSubtitleBytes: MAX_SUBTITLE_BYTES,
    userAgent: process.env.SUBTITLE_USER_AGENT || DEFAULT_USER_AGENT,
    // Both accept a comma-separated list: the free tiers are metered per account,
    // so a household pools one key each and the daily budget adds up.
    openSubtitlesKeys: parseKeys(process.env.OPENSUBTITLES_API_KEY),
    subdlKeys: parseKeys(process.env.SUBDL_API_KEY),
    // No key and no account: this one needs an address and nothing else, so it
    // is on by default, and this is its *only* switch - it takes no part in
    // providerOrder above. Setting it to an empty string turns it off.
    subsceneUrl: parseSubsceneUrl(subsceneUrlSetting()),
    warnings,
};

module.exports = config;
