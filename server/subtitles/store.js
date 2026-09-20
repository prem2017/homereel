const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const { resolveMediaPath, toRelative } = require('../mediaPath');
const { parseVideoName, videoSlug, subtitleFileName, parseSubtitleFileName } = require('./naming');

/**
 * Turning downloaded bytes into a subtitle file sitting next to the video.
 *
 * The media folder is writable, and this is the only code that writes to it, so
 * the rules live here rather than being spread across the providers:
 *
 *   - the filename is derived from the *video* and from this app's own tables,
 *     never from anything a provider said, so a hostile `file_name` has nothing
 *     to steer (the scheme itself is in naming.js) - and that video must exist;
 *   - only .srt and .vtt are ever created;
 *   - an existing file is never overwritten - a rejected subtitle stays on disk
 *     under its own name, which is what makes "try another one" non-destructive;
 *   - the content is proved to be a subtitle before it lands. A provider link
 *     that quietly 302s to an ad page returns HTML with HTTP 200, and writing
 *     that beside someone's films would be the sort of mess this app should not
 *     be capable of making.
 */

// SRT and VTT both key off a cue timing line. Nothing else this app might be
// handed by accident - HTML, JSON, an .ass file, a login page - contains one.
const CUE_TIMING = /\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->/;

/**
 * Decode subtitle bytes to text.
 *
 * Subtitles are frequently not UTF-8: a decade of SRT files were written in
 * whatever single-byte codepage the author's editor defaulted to, and decoding
 * those as UTF-8 gives a file of replacement characters rather than an error.
 * So try UTF-8 strictly, and fall back rather than silently mangling.
 *
 * ponytail: the fallback is windows-1252 only (ceiling: Latin-script languages).
 * Upgrade: sniff the charset - legacy Cyrillic, Greek, Hebrew and Arabic files
 * need cp1251/1253/1255/1256 respectively - if anyone reports mojibake.
 */
const decodeSubtitle = (buffer) => {
    // A byte order mark names UTF-16 outright - it is what Windows editors save
    // as "Unicode" - and TextDecoder drops the mark itself.
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return text.replace(/^﻿/, '');
    } catch {
        return new TextDecoder('windows-1252').decode(buffer).replace(/^﻿/, '');
    }
};

const looksLikeSubtitle = (text) => CUE_TIMING.test(text);

// WebVTT must announce itself on the first line; anything else that carries cue
// timings is SRT as far as this app is concerned.
const extensionFor = (text) => (text.trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt');

/**
 * How many subtitles this app has already saved for one video in one language.
 *
 * Read off the folder rather than kept anywhere: the counter is in the filename,
 * so the files are their own record. A subtitle the user deleted stops counting,
 * which is what they meant by deleting it, and the highest counter still on disk
 * is what the next one has to clear - counting entries instead would reuse a
 * number after a deletion.
 *
 * The source prefix is deliberately not part of the match. "How many English
 * subtitles do I have for this film" is a question about the film, not about who
 * supplied them.
 */
const countedSoFar = (dir, slug, language) => {
    let highest = 0;
    for (const entry of fs.readdirSync(dir)) {
        const parsed = parseSubtitleFileName(entry);
        if (parsed && parsed.video === slug && parsed.language === language) {
            highest = Math.max(highest, parsed.counter);
        }
    }
    return highest;
};

/**
 * First free path of the form "<source>_<video>_<resolution>_<lang><counter>.srt".
 *
 * The counter starts past everything already saved, and the loop only runs on
 * beyond that if a name is somehow taken anyway - by a file this app did not
 * write, or by the other half of a race.
 */
const freeTargetPath = (videoAbsPath, provider, language, extension) => {
    const dir = path.dirname(videoAbsPath);
    const video = parseVideoName(path.basename(videoAbsPath));
    const start = countedSoFar(dir, videoSlug(video), language) + 1;

    for (let counter = start; counter < start + 50; counter += 1) {
        const name = subtitleFileName({ provider, video, language, counter, extension });
        const candidate = path.join(dir, name);
        if (!fs.existsSync(candidate)) return candidate;
    }
    // 50 collisions past the highest counter means something is looping.
    throw new Error('Too many subtitle files already saved for this video and language.');
};

const isMediaFile = (fileName) => {
    const type = mime.lookup(fileName) || '';
    return type.startsWith('video/') || type.startsWith('audio/');
};

/**
 * The absolute path of the video a subtitle is for - one that is really there.
 *
 * A saved subtitle is named after its video, which makes the video the one thing
 * that can name a destination; a path to nothing would name a subtitle after a
 * film that does not exist. index.js asks this before any provider too, so a bad
 * path costs no download quota.
 */
const requireVideo = (videoRelPath) => {
    const videoAbsPath = resolveMediaPath(videoRelPath);
    if (!videoAbsPath) throw Object.assign(new Error('Access denied'), { status: 403 });

    let stat = null;
    try {
        stat = fs.statSync(videoAbsPath);
    } catch { /* not there - reported below */ }

    if (!stat || !stat.isFile() || !isMediaFile(videoAbsPath)) {
        throw Object.assign(new Error('That video is not in the media folder.'), { status: 404 });
    }
    return videoAbsPath;
};

/**
 * Validate, name and write. Returns the saved file as the client sees it:
 * a path relative to the media root, plus its display name.
 */
const saveSubtitle = async ({ videoRelPath, language, buffer, provider }) => {
    const videoAbsPath = requireVideo(videoRelPath);

    const text = decodeSubtitle(buffer);
    if (!looksLikeSubtitle(text)) {
        throw new Error('The file that came back was not a subtitle.');
    }

    const target = freeTargetPath(videoAbsPath, provider, language, extensionFor(text));

    // The target is built from an already-contained path, so this cannot fail -
    // which is exactly why it is worth asserting. Every write in this app goes
    // through the same check as every read.
    const relative = toRelative(target);
    if (!resolveMediaPath(relative)) throw new Error('Access denied');

    // "wx" fails if the file appeared between the existence check and here,
    // rather than truncating someone else's subtitle.
    await fsp.writeFile(target, text, { encoding: 'utf8', flag: 'wx' });

    return { path: relative, name: path.basename(target) };
};

module.exports = {
    saveSubtitle, requireVideo, isMediaFile, decodeSubtitle, looksLikeSubtitle, extensionFor, freeTargetPath,
};
