const ptt = require('parse-torrent-title');

/**
 * Pull a title, year and season/episode out of a release name such as
 * "Ford.V.Ferrari.2019.1080p.BluRay.x264-SPARKS".
 *
 * Only used when the moviehash misses. Hand-rolling this looks easy and is not:
 * separators, bracketed years, "1x03" versus "S01E03", and release-group suffixes
 * all have to come off before a provider's title search will match anything.
 */
const parseVideoName = (fileName) => {
    const base = fileName.replace(/\.[^.]+$/, '');
    const info = ptt.parse(base);

    return {
        base,
        title: info.title || base,
        year: info.year || null,
        // "720p", "1080p" - only ever used to label the saved subtitle.
        resolution: info.resolution || null,
        // A season with no episode is meaningless here, and vice versa.
        season: Number.isInteger(info.season) ? info.season : null,
        episode: Number.isInteger(info.episode) ? info.episode : null,
    };
};

// Comparison key for release names. Case, separators and punctuation all vary
// between the video file and a provider's `release` field without meaning
// anything, so strip them before comparing.
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * How well a candidate matches the video, best first. The tier decides
 * everything; a provider's position in the configured list only breaks ties
 * *within* a tier.
 *
 * Ranking by source instead would mean routinely preferring a title guess over a
 * hash match. Out of sync is the failure mode that makes a downloaded subtitle
 * useless, so the guaranteed-synced result has to win no matter who supplied it.
 */
const TIER = { HASH: 0, RELEASE: 1, TITLE: 2 };

const tierOf = (candidate, video) => {
    if (candidate.hashMatch) return TIER.HASH;

    const release = normalize(candidate.release);
    const base = normalize(video.base);
    if (release && base && release === base) return TIER.RELEASE;

    return TIER.TITLE;
};

/**
 * Sort candidates in place and return them. `providerOrder` is the configured
 * provider list, so a user who prefers one site still gets their way whenever
 * match quality is equal.
 */
const rankCandidates = (candidates, video, providerOrder = []) => {
    const positionOf = (name) => {
        const at = providerOrder.indexOf(name);
        return at === -1 ? providerOrder.length : at;
    };

    return candidates
        .map((candidate) => ({ candidate, tier: tierOf(candidate, video) }))
        .sort((a, b) =>
            a.tier - b.tier ||
            positionOf(a.candidate.provider) - positionOf(b.candidate.provider) ||
            (b.candidate.downloads || 0) - (a.candidate.downloads || 0))
        .map(({ candidate, tier }) => ({ ...candidate, tier }));
};

/**
 * The name a downloaded subtitle is saved under:
 *
 *     <source>_<video>_<resolution>_<language><counter>.<srt|vtt>
 *     OS_Ford-V-Ferrari_1080p_en1.srt
 *     SD_Au-Service-De-La-France-S01E01_fr3.srt      (no resolution in the name)
 *
 * Every segment is derived from the video file and from this app's own tables.
 * Nothing a provider said is in it, which is the rule that lets the media folder
 * be writable at all (see store.js).
 *
 * The counter is the point of the scheme rather than decoration: it is the count
 * of subtitles already saved for this video in this language, plus one. That
 * makes the folder itself the record of what has been taken, so "that one is no
 * good, get me another" survives a restart with no state file to keep in sync.
 *
 * Segments are joined with "_" and the video slug is stripped of it, so the name
 * reads back unambiguously. `parseSubtitleFileName` is the reader; keep the two
 * in step, and note web/src/utils/subtitleNaming.ts holds a reader for the
 * client that has to agree with this one.
 */
const PROVIDER_SHORT = { opensubtitles: 'OS', subdl: 'SD', subscene: 'SS' };

const shortNameFor = (provider) => (
    PROVIDER_SHORT[provider]
    || String(provider || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()
    || 'XX'
);

// Long release names make for unusable filenames on a TV, and a subtitle sitting
// at the filesystem's 255-byte limit cannot be written at all.
const SLUG_MAX = 60;

const slugify = (value) => String(value || '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The part of the name that says which video this belongs to.
 *
 * The parsed title rather than the raw release name, because the release name
 * already carries the resolution and a group suffix and would repeat them. The
 * episode marker is appended when there is one - without it every episode in a
 * season folder would share a name, and so would share a counter.
 */
const videoSlug = (video) => {
    const title = slugify(video.title);
    const episode = video.season !== null && video.episode !== null
        ? `-S${pad2(video.season)}E${pad2(video.episode)}`
        : '';

    return title ? `${title}${episode}` : slugify(video.base) || 'video';
};

const subtitleFileName = ({ provider, video, language, counter, extension }) => {
    const parts = [shortNameFor(provider), videoSlug(video)];
    if (video.resolution) parts.push(video.resolution);

    return `${parts.join('_')}_${language}${counter}.${extension}`;
};

/**
 * Read a name back, or null if this app did not write it. Used to count what is
 * already on disk; a file the user brought themselves simply does not parse.
 */
const parseSubtitleFileName = (fileName) => {
    const match = /^([A-Za-z0-9]+)_(.+)_([A-Za-z]{2,3})(\d+)\.(srt|vtt)$/i.exec(fileName);
    if (!match) return null;

    let [, provider, video, language, counter, extension] = match;

    // Greedy above, so the resolution - when present - is still sitting on the
    // end of the middle segment.
    const withResolution = /^(.+)_(\d{3,4}[pi])$/i.exec(video);
    const resolution = withResolution ? withResolution[2] : null;
    if (withResolution) video = withResolution[1];

    return {
        provider,
        video,
        resolution,
        language: language.toLowerCase(),
        counter: Number(counter),
        extension: extension.toLowerCase(),
    };
};

module.exports = {
    parseVideoName,
    normalize,
    rankCandidates,
    TIER,
    shortNameFor,
    videoSlug,
    subtitleFileName,
    parseSubtitleFileName,
};
