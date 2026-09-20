const config = require('../config');
const { getJson, getBytes } = require('../http');
const { Keyring } = require('../keyring');

/**
 * OpenSubtitles' REST API (api.opensubtitles.com/api/v1).
 *
 * The only provider that can match on moviehash, which is why it is first in the
 * default order: a hash hit is a subtitle timed against this exact release, and
 * no amount of title cleverness elsewhere beats that.
 *
 * Quota is the thing to remember here - 5 downloads a day anonymously, 20 with a
 * free account. Searching is not metered, downloading is, which is why the two
 * are separate endpoints in this app rather than one convenience call.
 */
const BASE = 'https://api.opensubtitles.com/api/v1';

// Mostly ISO 639-1, with a few regional splits that have no plain code. Asking
// for "pt" alone silently matches nothing, which is a miserable thing to debug.
const LANGUAGE_ALIASES = {
    pt: 'pt-PT,pt-BR',
    zh: 'zh-CN,zh-TW',
};

const name = 'opensubtitles';

const keyring = new Keyring(config.openSubtitlesKeys);

const configured = () => (keyring.size > 0
    ? { ok: true }
    : { ok: false, reason: 'No OPENSUBTITLES_API_KEY set in .env' });

const headers = (key) => ({
    'Api-Key': key,
    'User-Agent': config.userAgent,
});

const search = async ({ video, hash, language }) => {
    const params = new URLSearchParams({
        languages: LANGUAGE_ALIASES[language] || language,
    });

    // Send the hash *and* the title query in one call. The API returns hash
    // matches flagged with moviehash_match alongside ordinary title results, so
    // one request covers both tiers - and costs nothing extra, search being
    // unmetered.
    if (hash) params.set('moviehash', hash);
    params.set('query', video.title);
    if (video.season !== null && video.episode !== null) {
        params.set('season_number', String(video.season));
        params.set('episode_number', String(video.episode));
    } else if (video.year) {
        params.set('year', String(video.year));
    }

    // Unmetered, so a key that has spent its downloads for the day is still
    // perfectly good here - and the candidate list is exactly what the user wants
    // to see once the quota is gone.
    const { value: body } = await keyring.run((key) => getJson(`${BASE}/subtitles?${params}`, {
        headers: headers(key),
        timeoutMs: config.timeoutMs,
    }), { metered: false });

    return (body.data || []).flatMap((item) => {
        const attributes = item.attributes || {};
        const file = (attributes.files || [])[0];
        if (!file || file.file_id === undefined) return [];

        return [{
            provider: name,
            ref: String(file.file_id),
            language: attributes.language || language,
            release: attributes.release || '',
            fileName: file.file_name || '',
            downloads: attributes.download_count || 0,
            hashMatch: attributes.moviehash_match === true,
        }];
    });
};

const download = async (ref) => {
    // `ref` came back through the client, so it is untrusted by the time it
    // returns. A file_id is a number and nothing else.
    if (!/^\d+$/.test(ref)) throw new Error('Invalid subtitle reference.');

    // Only this call is wrapped: it is the metered one, and it is the only one
    // that authenticates. The fetch below goes to a CDN with no key at all, so a
    // 403 from it means a dead link, not a bad key - rotating on that would spend
    // a second person's quota on the same broken download.
    const { value: body, entry } = await keyring.run((key) => getJson(`${BASE}/download`, {
        method: 'POST',
        headers: { ...headers(key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: Number(ref) }),
        timeoutMs: config.timeoutMs,
    }));

    // The reply says what is left on that key, which saves discovering it by
    // hitting 406 on the next download.
    keyring.note(entry, { remaining: body.remaining, resetIso: body.reset_time_utc });

    if (!body.link) throw new Error('The provider returned no download link.');

    const buffer = await getBytes(body.link, {
        maxBytes: config.maxDownloadBytes,
        timeoutMs: config.timeoutMs,
        headers: { 'User-Agent': config.userAgent },
    });

    // Surfaced to the UI: with a handful of downloads a day, knowing how many
    // are left is the difference between "try another" being a decision and a
    // surprise. With a pool of keys the count alone is misleading, so it is
    // labelled with which key it belongs to.
    return {
        buffer,
        quota: body.remaining === undefined
            ? null
            : {
                remaining: body.remaining,
                resetTime: body.reset_time || null,
                key: keyring.size > 1 ? entry.label : null,
            },
    };
};

module.exports = { name, configured, search, download };
