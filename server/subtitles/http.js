/**
 * Every byte fetched here comes from a third party, so both limits below are
 * load-bearing rather than tidiness: without the timeout a hung provider stalls
 * a request the user is watching a spinner for, and without the byte cap a
 * provider (or something impersonating one) can stream until the process dies.
 */
const DEFAULT_TIMEOUT_MS = 12000;

class HttpError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

// Loopback, RFC1918, link-local (which covers cloud metadata at 169.254.169.254)
// and IPv6 loopback / unique-local.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i;

/**
 * Refuse a URL before fetching it.
 *
 * This app fetches URLs that third parties chose - a CDN link in an API reply, a
 * ZIP href scraped out of a page - so the fetch is a place someone else's data
 * gets to name a destination. Left open, the server becomes a way for anything
 * that can talk to a provider to reach machines on the user's LAN that it cannot
 * reach itself, from outside the network.
 *
 * ponytail: matches on the literal host (ceiling: an attacker who cannot control
 * DNS). Upgrade: resolve the name first and check the address it returns, if a
 * provider is ever added whose links are attacker-chosen rather than merely
 * third-party.
 */
const assertFetchable = (url) => {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new HttpError(`Not a usable URL: ${String(url).slice(0, 80)}`);
    }

    // file:, data: and the rest have no business here.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new HttpError(`Refusing to fetch a ${parsed.protocol} URL.`);
    }
    if (PRIVATE_HOST.test(parsed.hostname)) {
        throw new HttpError(`Refusing to fetch from ${parsed.hostname}.`);
    }
    return parsed.toString();
};

/**
 * fetch() with a deadline, returning the parsed JSON body.
 * Provider APIs answer in kilobytes, so no size cap is needed on this path.
 */
const getJson = async (url, { headers = {}, method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    const response = await fetch(assertFetchable(url), {
        method,
        headers: { Accept: 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
        // Providers explain their refusals in the body - quota exhausted, bad key -
        // and those messages are worth far more on screen than "401".
        let detail = '';
        try {
            const text = (await response.text()).slice(0, 300);
            if (text) detail = ` - ${text}`;
        } catch { /* body unreadable; the status is all we have */ }
        throw new HttpError(`HTTP ${response.status}${detail}`, response.status);
    }
    return response.json();
};

/**
 * Download a file into memory, refusing anything larger than `maxBytes`.
 *
 * Content-Length is checked first because it is free, but it is only a claim -
 * the stream is counted as it arrives so a lying or absent header cannot get
 * past the cap.
 */
const getBytes = async (url, { headers = {}, maxBytes, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    const response = await fetch(assertFetchable(url), { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status);

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError(`Refusing ${declared} bytes; the limit is ${maxBytes}.`);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes) throw new HttpError(`Download exceeded ${maxBytes} bytes.`);
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

/**
 * Fetch a page as text, with the same deadline and byte cap as getBytes.
 */
const getText = async (url, options = {}) => (await getBytes(url, options)).toString('utf8');

module.exports = { getJson, getBytes, getText, assertFetchable, HttpError, DEFAULT_TIMEOUT_MS };
