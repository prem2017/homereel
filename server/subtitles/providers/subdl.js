const config = require('../config');
const { getJson, getBytes } = require('../http');
const { Keyring } = require('../keyring');

/**
 * SubDL (api.subdl.com/api/v1).
 *
 * The backup source. No moviehash support, so it can never reach the top tier of
 * the ranking, but it searches on release name - which lands in the second tier
 * often enough to be useful - and it has its own daily allowance, so it roughly
 * doubles the budget on a day OpenSubtitles has been used up.
 *
 * Its downloads are ZIPs; the caller unpacks them.
 */
const BASE = 'https://api.subdl.com/api/v1';

// Downloads live on a fixed host. Pinning it here is what stops a crafted `ref`
// from turning this endpoint into a proxy for fetching arbitrary URLs from
// inside the user's network.
const DOWNLOAD_HOST = 'https://dl.subdl.com';
const SAFE_REF = /^\/[A-Za-z0-9._/-]+\.zip$/;

const name = 'subdl';

const keyring = new Keyring(config.subdlKeys);

const configured = () => (keyring.size > 0
    ? { ok: true }
    : { ok: false, reason: 'No SUBDL_API_KEY set in .env' });

/**
 * SubDL reports refusals in the body with HTTP 200, so the wording is the only
 * signal about which kind of refusal it is. Classifying it is what lets the next
 * key take over; anything unrecognised stays a plain failure and stops there,
 * rather than quietly working through the pool.
 *
 * ponytail: matching on message text (ceiling: their current wording). Upgrade:
 * switch to a code if SubDL ever returns one - this is the whole reason the
 * status-code path exists for OpenSubtitles.
 */
const refusal = (message) => {
    const text = message || 'Search was refused.';
    const error = new Error(text);
    if (/limit|quota|exceed/i.test(text)) error.quotaExhausted = true;
    if (/api.?key|unauthori[sz]ed/i.test(text)) error.status = 401;
    return error;
};

const search = async ({ video, language }) => {
    const params = new URLSearchParams({
        languages: language.toUpperCase(),
        subs_per_page: '30',
    });

    // Searching by the full release name is what gives this provider a chance at
    // an exact-release match; the parsed title is the fallback it can always use.
    params.set('file_name', video.base);
    params.set('film_name', video.title);
    if (video.season !== null) params.set('season_number', String(video.season));
    if (video.episode !== null) params.set('episode_number', String(video.episode));

    const { value: body } = await keyring.run(async (key) => {
        params.set('api_key', key);
        const reply = await getJson(`${BASE}/subtitles?${params}`, { timeoutMs: config.timeoutMs });
        if (reply.status === false) throw refusal(reply.error);
        return reply;
    }, { metered: false });

    return (body.subtitles || []).flatMap((item) => {
        if (!item.url || !SAFE_REF.test(item.url)) return [];

        return [{
            provider: name,
            ref: item.url,
            language: (item.language || language).toLowerCase().slice(0, 2),
            release: item.release_name || '',
            fileName: item.name || item.release_name || '',
            downloads: 0, // Not reported; ties fall through to provider order.
            hashMatch: false,
        }];
    });
};

const download = async (ref) => {
    // Re-checked rather than trusted: this value did a round trip through the
    // client between search and download.
    if (!SAFE_REF.test(ref)) throw new Error('Invalid subtitle reference.');

    const buffer = await getBytes(`${DOWNLOAD_HOST}${ref}`, {
        maxBytes: config.maxDownloadBytes,
        timeoutMs: config.timeoutMs,
        headers: { 'User-Agent': config.userAgent },
    });

    return { buffer, quota: null };
};

module.exports = { name, configured, search, download };
