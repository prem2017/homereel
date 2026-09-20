const config = require('../config');
const { getBytes, getText } = require('../http');
const { detectLanguage } = require('../languages');

/**
 * Subscene - by ID only, and deliberately so.
 *
 * The original subscene.com shut down in May 2024; the site answering at
 * sub-scene.com today is a clone under unknown ownership, which is why its
 * address lives in .env rather than being compiled in here. It has a working
 * default, so the feature is on out of the box; if the site moves again, or the
 * user prefers a different mirror, that is a one-line edit in .env.
 *
 * **This provider cannot search, and that is not an oversight.** The site has no
 * API, and `/search?query=` answers 403 with `cf-mitigated: challenge` - a
 * Cloudflare interstitial. Getting past that means defeating bot detection,
 * which this project does not do. What *is* open, with an honest User-Agent and
 * with robots.txt allowing it, is `/subtitle/<id>`: it returns 200 and carries a
 * direct link to the archive.
 *
 * So the division of labour is: the user browses the site themselves and copies
 * the ID out of the address bar, and this fetches it. `search()` returns nothing,
 * which keeps the provider out of the ranked list without failing the search for
 * the sources that can answer.
 */
const name = 'subscene';

// A page id out of a URL like https://sub-scene.com/subtitle/2847391. Anything
// outside this cannot reach the fetch, so a crafted "id" of "../../admin" or a
// whole URL is refused before it is interpolated into a path.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// The site serves its archives off a separate host, and that link is read out of
// the page - so it is pinned here rather than trusted. Not a setting: a user has
// no way to know what this should be, and a wrong value only breaks downloads.
// If the site moves its CDN, this line is the edit.
const DOWNLOAD_HOSTS = ['res.subscene.best'];

// The only switch this provider has, and it takes no part in SUBTITLE_PROVIDERS
// - see STANDALONE in providers/index.js.
const configured = () => (config.subsceneUrl
    ? { ok: true }
    : {
        ok: false,
        reason: 'SUBSCENE_URL is empty in .env. Put a working Subscene address there and restart.',
    });

const search = async () => [];

const hostOf = (url) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
};

/**
 * Pull the archive link out of the page.
 *
 * Both an `href` and a bare URL in the markup are accepted, because the shape of
 * a page nobody controls is not something to be precious about - but the host is
 * checked against DOWNLOAD_HOSTS either way. That check is the same one subdl's
 * pinned DOWNLOAD_HOST performs, and it matters more here: this link came out of
 * someone else's HTML, so without it a modified page could name any address it
 * liked and this endpoint would fetch it. (`assertFetchable` in http.js is the
 * backstop that keeps even an allowed host off the LAN.)
 */
const findArchiveLink = (html, pageUrl) => {
    const allowed = new Set([hostOf(config.subsceneUrl), ...DOWNLOAD_HOSTS]);

    const candidates = [
        ...[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
        ...[...html.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((m) => m[0]),
    ];

    for (const raw of candidates) {
        let resolved;
        try {
            resolved = new URL(raw, pageUrl);
        } catch {
            continue;
        }
        if (!/\.(zip|srt|vtt)$/i.test(resolved.pathname)) continue;
        if (!allowed.has(resolved.hostname.toLowerCase())) continue;
        return resolved.toString();
    }
    return null;
};

/**
 * What language the page says this subtitle is.
 *
 * The site states it twice - "<title>Subscene - <film> - French subtitle" and
 * again in the archive filename ("..._french-1863000.zip") - and it is a fact
 * about the file the user asked for, so it beats anything chosen in a menu.
 *
 * Read off the *end* of the title, not scanned out of the page: a film called
 * "The French Connection" would otherwise answer for its own name, and a nav bar
 * saying "English" would answer for everything.
 */
const languageOfPage = (html, link) => {
    const title = /<title>([^<]*)<\/title>/i.exec(html);
    const stated = title && /[-–]\s*([^-–]+?)\s+subtitles?\s*$/i.exec(title[1].trim());

    return (stated && detectLanguage(stated[1]))
        || (link && detectLanguage(decodeURIComponent(new URL(link).pathname.split('/').pop())))
        || null;
};

/**
 * What the page says this subtitle is, with "Subscene - " taken off the front.
 *
 * Worth showing: "Le Bureau des Légendes (The Bureau) - First Season - French
 * subtitle" is the difference between knowing the digits are well-formed and
 * knowing they are the right subtitle - and it states the language too, so there
 * is nothing extra to look up.
 */
const titleOfPage = (html) => {
    const found = /<title>([^<]*)<\/title>/i.exec(html);
    if (!found) return null;

    // "&amp;" last, or a literal "&quot;" in a title would be decoded twice.
    const title = found[1].trim()
        .replace(/^subscene\s*[-–]\s*/i, '')
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
    return title || null;
};

// The one fetch both halves of this provider need. Shared so the question the
// check answers is literally the question the download asks - see check().
const fetchPage = async (ref) => {
    if (!SAFE_ID.test(ref)) {
        throw Object.assign(
            new Error('A Subscene ID is the number at the end of the subtitle page URL.'),
            { status: 400 }
        );
    }
    if (!config.subsceneUrl) {
        throw Object.assign(new Error(configured().reason), { status: 400 });
    }

    const pageUrl = `${config.subsceneUrl}/subtitle/${ref}`;
    try {
        const html = await getText(pageUrl, {
            maxBytes: config.maxDownloadBytes,
            timeoutMs: config.timeoutMs,
            headers: { 'User-Agent': config.userAgent, Accept: 'text/html' },
        });
        return { pageUrl, html, link: findArchiveLink(html, pageUrl) };
    } catch (e) {
        // The address in .env is the thing most likely to be wrong here, and this
        // is the one provider where that is a routine event rather than an
        // outage: the site is a clone that has already moved once and answers at
        // whatever domain is standing this month. So the failure names the fix
        // instead of reporting a status nobody can act on. Kept apart from "no
        // such id", which is a 200 with no link - that one is fixed by typing a
        // different number, this one by editing a file.
        throw Object.assign(
            new Error(`${hostOf(pageUrl) || 'That address'} is not answering (${e.message}). `
                + 'Subscene is a clone and its domain changes - find one that works, '
                + 'set SUBSCENE_URL in .env and restart.'),
            { status: 502, unreachable: true }
        );
    }
};

/**
 * Does this id lead to anything?
 *
 * The same page and the *same* predicate the download uses, which is the point:
 * a yes here means Get will work, not that the digits look plausible. That
 * distinction is not academic - /subtitle/12345 is a real page for The Matrix in
 * Serbian carrying no file at all, so a regex says yes and the download then
 * fails with nothing on screen to explain it. So does an id that does not exist:
 * the site answers 302 to its own front page, which is a 200 by the time fetch
 * has followed it.
 *
 * Cheap enough to ask while the user is still typing because this site has no
 * account and no quota. A metered provider does not get one of these without the
 * argument that split search from download in the first place.
 */
const check = async (ref) => {
    try {
        const { html, link } = await fetchPage(ref);
        if (!link) return { ok: false, reason: 'No subtitle to download at that ID.' };
        return { ok: true, title: titleOfPage(html), language: languageOfPage(html, link) };
    } catch (e) {
        // Every one of these is a verdict the box has somewhere to put, so none
        // of them is thrown: a bad id and a dead domain both mean "not yet", but
        // they call for different edits, and `unreachable` is what tells them
        // apart on screen.
        return { ok: false, unreachable: Boolean(e.unreachable), reason: e.message };
    }
};

const download = async (ref) => {
    const { pageUrl, html, link } = await fetchPage(ref);
    if (!link) {
        // Either the id does not exist, or the page changed shape. Both are worth
        // saying plainly: there is no API here to give a proper status.
        throw new Error(`No subtitle download found on ${pageUrl}. Check the ID, or the site has changed.`);
    }

    const buffer = await getBytes(link, {
        maxBytes: config.maxDownloadBytes,
        timeoutMs: config.timeoutMs,
        headers: { 'User-Agent': config.userAgent, Referer: pageUrl },
    });

    return { buffer, quota: null, language: languageOfPage(html, link) };
};

module.exports = {
    name, configured, search, check, download,
    findArchiveLink, languageOfPage, titleOfPage, SAFE_ID,
};
