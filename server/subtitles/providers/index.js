const config = require('../config');
const opensubtitles = require('./opensubtitles');
const subdl = require('./subdl');
const subscene = require('./subscene');

/**
 * The provider registry.
 *
 * A provider is four things: a name, a way to say whether it is usable, a search
 * that returns candidates, and a download that returns bytes. Nothing else in
 * the feature knows which provider it is talking to, which is what lets the
 * scraper-driven sites join later without touching the ranking, the store or the
 * endpoints.
 */
/**
 * Sources that can be *searched*. SUBTITLE_PROVIDERS selects and orders these,
 * and only these.
 */
const SEARCHABLE = [opensubtitles, subdl];

/**
 * Sources reached by a reference the user supplies, which take no part in that
 * list.
 *
 * Subscene is the only one, and the split is the whole reason it works at all:
 * its search page is behind a bot check, so `search()` returns nothing and it
 * never produces a candidate for SUBTITLE_PROVIDERS to rank. Leaving it in that
 * list meant a setting documented entirely as an *ordering preference* was also
 * the on/off switch for the ID box - so writing the list out by hand, which the
 * file invites, silently removed a control that stayed on screen. Its address is
 * its only configuration now.
 */
const STANDALONE = [subscene];

const BUILT_IN = [...SEARCHABLE, ...STANDALONE];

const byName = new Map(BUILT_IN.map((provider) => [provider.name, provider]));
const searchableNames = new Set(SEARCHABLE.map((provider) => provider.name));

/**
 * Searchable providers in the order the user configured, with unknown names
 * reported rather than dropped - a typo in SUBTITLE_PROVIDERS should not
 * silently disable a source and leave no trace of why.
 */
const resolveProviders = () => {
    const active = [];
    const problems = [];

    for (const name of config.providerOrder) {
        // A leftover "subscene" here was valid until the split above and does no
        // harm now: it is switched on elsewhere, so this is not a disabled source
        // needing an explanation, and `problems` is flashed after every search.
        if (!searchableNames.has(name)) {
            if (!byName.has(name)) {
                problems.push({ name, reason: 'Unknown provider name in SUBTITLE_PROVIDERS' });
            }
            continue;
        }

        const provider = byName.get(name);
        const state = provider.configured();
        if (!state.ok) {
            problems.push({ name, reason: state.reason });
            continue;
        }
        active.push(provider);
    }

    return { active, problems };
};

/**
 * Why one named source cannot be used, for a request that asked for it by name.
 *
 * Deliberately not the same thing as `problems` above. That list is what the UI
 * flashes after a search; this answers the other question - "I asked for *this*
 * source, so why did nothing happen?" - and it has to name the line of .env that
 * caused it. The one message this replaced, "Unknown or unconfigured provider",
 * named nothing, so a perfectly good Subscene id read as a broken id.
 *
 * The order of the two tests matters: a source explains its own configuration
 * first, and only a *searchable* one is then subject to SUBTITLE_PROVIDERS.
 */
const providerStatus = (name) => {
    const provider = byName.get(name);
    // Not echoed back: it came from the client, so repeating it says nothing the
    // caller does not already know.
    if (!provider) return { ok: false, reason: 'No such subtitle source.' };

    const state = provider.configured();
    if (!state.ok) return { ok: false, reason: state.reason };

    if (searchableNames.has(name) && !config.providerOrder.includes(name)) {
        return {
            ok: false,
            reason: `${name} is switched off - it is not listed in SUBTITLE_PROVIDERS in .env. `
                + 'Add it to that line and restart.',
        };
    }

    return { ok: true, provider };
};

module.exports = { resolveProviders, providerStatus, BUILT_IN, SEARCHABLE, STANDALONE };
