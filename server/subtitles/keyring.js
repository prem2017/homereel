/**
 * A pool of API keys for one provider, tried in turn.
 *
 * Why more than one: these free tiers are metered per account - OpenSubtitles
 * allows 20 downloads a day - and a household watching together gets through
 * that. Everyone registers their own key, they all go into the one setting
 * comma-separated, and the daily budget adds up.
 *
 * A key is set aside for two different reasons, and the difference matters:
 *
 *   - out of quota (406, 429): temporary. It comes back when the provider's
 *     counter resets, so we record when and retry after that.
 *   - rejected (401, 403): wrong, revoked, or the account was never verified.
 *     Retrying costs a round trip every time and will never succeed, so it stays
 *     out until restart and its reason is carried to the UI.
 *
 * Anything else - a timeout, a 500, a DNS failure - is *not* a key problem, and
 * rotating on it would burn every key in the pool over one bad afternoon at the
 * provider. Those propagate untouched.
 *
 * `metered` is the other half of the design. Searching is free and only
 * downloading is counted, so a key that has spent its downloads is still perfectly
 * good for search. Treating the two the same would mean the candidate list
 * disappears the moment the last download is used - exactly when the user most
 * needs to see what was on offer.
 *
 * State is in memory only. A restart forgets which keys were spent, which costs
 * at most one request per key that answers 406 and is marked again - far cheaper
 * than a file to keep in sync.
 */
const QUOTA_STATUS = new Set([406, 429]);
const REJECTED_STATUS = new Set([401, 403]);

// Used when the provider does not say when the counter resets. Short enough that
// a key wrongly judged spent is not lost for the evening.
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Split a setting into keys. Duplicates are collapsed: two people pasting the
 * same key is an easy mistake and would otherwise look like twice the quota.
 */
const parseKeys = (raw) => [...new Set(
    String(raw || '').split(',').map((key) => key.trim()).filter(Boolean)
)];

class Keyring {
    constructor(keys, now = Date.now) {
        this.now = now;
        this.entries = keys.map((key, index) => ({
            key,
            label: keys.length > 1 ? `key ${index + 1} of ${keys.length}` : 'key',
            spentUntil: 0,
            rejected: null,
        }));
    }

    get size() {
        return this.entries.length;
    }

    usable(metered) {
        const now = this.now();
        return this.entries.filter((entry) => (
            !entry.rejected && (!metered || entry.spentUntil <= now)
        ));
    }

    /** Why nothing is usable, phrased for the message the UI shows. */
    blockedReason(metered) {
        const now = this.now();
        const rejected = this.entries.filter((entry) => entry.rejected);
        const spent = this.entries.filter((entry) => !entry.rejected && entry.spentUntil > now);

        const bits = [];
        if (metered && spent.length > 0) {
            bits.push(`${spent.length} of ${this.size} out of downloads for today`);
        }
        if (rejected.length > 0) {
            bits.push(`${rejected.length} of ${this.size} rejected: ${rejected[0].rejected}`);
        }
        return bits.length > 0 ? bits.join('; ') : 'No API key configured.';
    }

    /** Set a key aside until the provider's counter resets. */
    setSpent(entry, resetIso) {
        const at = resetIso ? Date.parse(resetIso) : NaN;
        entry.spentUntil = Number.isFinite(at) && at > this.now()
            ? at
            : this.now() + RETRY_AFTER_MS;
    }

    /** Record what a successful call said was left on the key it used. */
    note(entry, { remaining, resetIso } = {}) {
        if (typeof remaining === 'number' && remaining <= 0) this.setSpent(entry, resetIso);
    }

    /**
     * Call `fn(key)` with each usable key until one answers.
     *
     * Returns `{ value, entry }` rather than the bare value so the caller can
     * record quota against the key that was actually used - which is not
     * knowable from the outside once rotation is in play.
     */
    async run(fn, { metered = true } = {}) {
        const usable = this.usable(metered);
        if (usable.length === 0) throw new Error(this.blockedReason(metered));

        let lastError = null;
        for (const entry of usable) {
            try {
                return { value: await fn(entry.key), entry };
            } catch (e) {
                if (REJECTED_STATUS.has(e.status)) {
                    entry.rejected = e.message;
                } else if (QUOTA_STATUS.has(e.status) || e.quotaExhausted) {
                    this.setSpent(entry, e.resetIso);
                } else {
                    // Not the key's fault - do not spend the rest of the pool on it.
                    throw e;
                }
                lastError = e;
            }
        }
        throw lastError;
    }
}

module.exports = { Keyring, parseKeys, RETRY_AFTER_MS };
