const fs = require('fs');
const path = require('path');
const config = require('./config');
const { movieHash } = require('./hash');
const { parseVideoName, rankCandidates } = require('./naming');
const { detectLanguage } = require('./languages');
const { resolveProviders, providerStatus } = require('./providers');
const { listSubtitleEntries, extractEntry, isZip } = require('./archive');
const { saveSubtitle, requireVideo, isMediaFile } = require('./store');
const { toRelative } = require('../mediaPath');

/**
 * Search every configured provider at once and return one ranked list.
 *
 * Providers are queried in parallel rather than in order-until-one-answers.
 * Trying them in sequence would mean the first configured source decides the
 * result, so a title guess from a preferred site would beat a hash match nobody
 * ever asked for. Merging first and ranking after keeps the user's ordering as a
 * tiebreaker without letting it override match quality.
 *
 * A provider that fails does not fail the search - it is reported in
 * `unavailable` so the UI can say so and carry on with the rest.
 */
const searchSubtitles = async ({ videoRelPath, language }) => {
    const videoAbsPath = requireVideo(videoRelPath);

    const video = parseVideoName(path.basename(videoAbsPath));
    const { active, problems } = resolveProviders();

    if (active.length === 0) {
        return { candidates: [], unavailable: problems, video };
    }

    // Worth 128 KB of reading even when only one provider can use it. A file
    // that is unreadable or too small is not an error - it just means no hash.
    let hash = null;
    try {
        hash = await movieHash(videoAbsPath);
    } catch (e) {
        console.warn(`Could not hash ${videoRelPath}: ${e.message}`);
    }

    const settled = await Promise.allSettled(
        active.map((provider) => provider.search({ video, hash, language }))
    );

    const candidates = [];
    const unavailable = [...problems];

    settled.forEach((result, index) => {
        const name = active[index].name;
        if (result.status === 'fulfilled') {
            candidates.push(...result.value);
        } else {
            console.warn(`Subtitle provider ${name} failed: ${result.reason?.message}`);
            unavailable.push({ name, reason: result.reason?.message || 'Unavailable' });
        }
    });

    return {
        candidates: rankCandidates(candidates, video, config.providerOrder),
        unavailable,
        video,
    };
};

/**
 * Which episode a name is about ("s1e5"), or null.
 *
 * `parseVideoName` already knows every way a release writes it - "S01E05",
 * "1x05" - and an entry in a season pack is named like a release, so one parser
 * reads both the video and the archive entry.
 */
const episodeKeyOf = (fileName) => {
    const parsed = parseVideoName(path.basename(fileName));
    return parsed.season !== null && parsed.episode !== null
        ? `s${parsed.season}e${parsed.episode}`
        : null;
};

const spell = (key) => key.replace(/s(\d+)e(\d+)/, (m, s, e) =>
    `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`);

/**
 * Which entry of an archive goes to which video.
 *
 * One id can be a whole season - sub-scene.com/subtitle/1863000 is ten episodes
 * in one ZIP - and the first entry in it is episode 1. Saving that while episode
 * 5 is playing produces the worst kind of wrong: the right filename over the
 * wrong dialogue, with nothing on screen to say so. So the entry is chosen by
 * episode, and if the archive turns out not to hold the episode playing, that is
 * an error rather than a substitution.
 *
 * The rest of the pack is then matched against the videos actually sitting in
 * the folder, and saved for them too. The archive has already been fetched and
 * the user has already spent the effort of finding the id: making them repeat
 * both nine times, for files this app is holding in memory, would be silly.
 *
 * Entry names are read only to *choose* and to match. Nothing is placed by one -
 * every path still comes from a video file (store.js).
 */
const planArchive = (entries, videoAbsPath) => {
    const wanted = episodeKeyOf(videoAbsPath);

    // A film, or a name that says nothing about episodes. Nothing to match on,
    // so the first usable entry it is.
    if (!wanted) return { mine: entries[0], extras: [] };

    const mine = entries.find((entry) => episodeKeyOf(entry) === wanted);
    if (!mine) {
        const held = [...new Set(entries.map(episodeKeyOf).filter(Boolean))].map(spell);
        // A season pack lists ten of these, which is a wall of text on a TV.
        const listed = held.length > 3 ? `${held[0]}-${held[held.length - 1]}` : held.join(', ');
        throw Object.assign(new Error(held.length > 0
            ? `That archive holds ${listed} - not ${spell(wanted)}, which is playing.`
            : 'That archive holds no subtitle for the episode that is playing.'),
        { status: 404 });
    }

    const dir = path.dirname(videoAbsPath);
    const videoOfEpisode = new Map();
    for (const name of fs.readdirSync(dir)) {
        if (!isMediaFile(name)) continue;
        const key = episodeKeyOf(name);
        if (key && key !== wanted && !videoOfEpisode.has(key)) videoOfEpisode.set(key, name);
    }

    const extras = [];
    const taken = new Set([wanted]);
    for (const entry of entries) {
        const key = episodeKeyOf(entry);
        // One subtitle per episode: a pack that carries two versions of episode 3
        // should not write both into the folder unasked.
        if (!key || taken.has(key) || !videoOfEpisode.has(key)) continue;
        taken.add(key);
        extras.push({ entry, videoAbsPath: path.join(dir, videoOfEpisode.get(key)) });
    }

    return { mine, extras };
};

/**
 * The one gate on "may this source be used", for both calls below.
 *
 * A name the client invented, one the user left out of SUBTITLE_PROVIDERS, and
 * one whose key has since been removed are three different situations, and
 * `providerStatus` keeps them apart so the refusal names the line of .env that
 * caused it. One shared answer for all three is what made a working Subscene id
 * look like a broken one.
 */
const usableProvider = (providerName) => {
    const status = providerStatus(providerName);
    if (!status.ok) throw Object.assign(new Error(status.reason), { status: 400 });
    return status.provider;
};

/**
 * Whether a reference the user typed leads to a real subtitle, before anything
 * is fetched for keeps.
 *
 * Only a source that can answer for free implements `check` - see subscene.js -
 * so this cannot spend a download allowance however often the UI calls it.
 */
const checkReference = async ({ provider: providerName, ref }) => {
    const provider = usableProvider(providerName);
    if (!provider.check) {
        throw Object.assign(new Error('That source has no reference to check.'), { status: 400 });
    }
    return provider.check(ref);
};

/**
 * Fetch one candidate and write it next to the video.
 *
 * `language` is what was *asked* for, and it is the weakest of the three things
 * that can say what a subtitle is written in. A provider that fetched a specific
 * file knows - subscene reads it off the page - and that has to win: a subtitle
 * taken by id was chosen on the site itself, where the menu in this app had no
 * say in the matter. Saving a French pack as "_en1.srt" because English was left
 * selected would be a lie in the one place this app keeps its records.
 */
const downloadSubtitle = async ({ videoRelPath, language: requested, provider: providerName, ref }) => {
    const provider = usableProvider(providerName);
    const videoAbsPath = requireVideo(videoRelPath);

    const { buffer, quota, language: declared } = await provider.download(ref);

    // "un" is ISO 639-2 for undetermined - the filename scheme needs a language
    // segment, and inventing a plausible one would be worse than admitting this.
    const languageOf = (entryName) => declared || requested || detectLanguage(entryName) || 'un';

    // The APIs differ on this and are not always honest about Content-Type, so
    // sniff rather than ask.
    if (!isZip(buffer)) {
        const language = languageOf('');
        // provider.name, not the name the client sent: it was matched against the
        // active list above, so it is one of this app's own.
        const saved = await saveSubtitle({ videoRelPath, language, buffer, provider: provider.name });
        return { ...saved, language, alsoSaved: [], quota };
    }

    const entries = await listSubtitleEntries(buffer);
    if (entries.length === 0) throw new Error('The archive contained no .srt or .vtt file.');

    const { mine, extras } = planArchive(entries, videoAbsPath);

    const bytesOf = async (entry) => {
        const bytes = await extractEntry(buffer, entry, config.maxSubtitleBytes);
        if (!bytes) throw new Error('The archive contained no .srt or .vtt file.');
        return bytes;
    };

    const language = languageOf(mine);
    const saved = await saveSubtitle({
        videoRelPath, language, buffer: await bytesOf(mine), provider: provider.name,
    });

    // One of these failing is not the download failing: the user asked for the
    // episode they are watching and they have it. So each is counted out rather
    // than allowed to take the whole call down.
    const alsoSaved = [];
    for (const extra of extras) {
        try {
            alsoSaved.push(await saveSubtitle({
                videoRelPath: toRelative(extra.videoAbsPath),
                language: languageOf(extra.entry),
                buffer: await bytesOf(extra.entry),
                provider: provider.name,
            }));
        } catch (e) {
            console.warn(`Could not save ${extra.entry}: ${e.message}`);
        }
    }

    return { ...saved, language, alsoSaved, quota };
};

module.exports = { searchSubtitles, checkReference, downloadSubtitle, planArchive, episodeKeyOf };
