const path = require('path');

const MEDIA_DIR = process.env.MEDIA_DIR || '/media';
const MEDIA_ROOT = path.resolve(MEDIA_DIR);

/**
 * Turn a client-supplied relative path into an absolute one that is guaranteed
 * to sit inside MEDIA_ROOT. Returns null if it escapes.
 *
 * This is the single trust boundary for every filesystem access the API
 * performs - reads and, since subtitle downloads landed, writes too. Clients
 * only ever see paths relative to MEDIA_ROOT, so the server's real directory
 * layout is never exposed.
 *
 * It lives in its own module so there is exactly one copy. A second
 * implementation that drifted from this one is precisely how the traversal bug
 * this replaced would come back.
 */
const resolveMediaPath = (relPath) => {
    if (typeof relPath !== 'string' || relPath.length === 0) return null;
    // A NUL byte can truncate the path inside libuv's syscalls.
    if (relPath.includes('\0')) return null;

    // resolve() collapses any ".." segments, and turns an absolute input such as
    // "/etc/passwd" into itself - both then fail the containment check below.
    const absolute = path.resolve(MEDIA_ROOT, relPath);

    // The separator matters: without it "/media-secrets" would pass a bare
    // startsWith("/media") check.
    if (absolute !== MEDIA_ROOT && !absolute.startsWith(MEDIA_ROOT + path.sep)) return null;

    return absolute;
};

// Relative path used in API responses, always with forward slashes so the
// client can treat it as an opaque URL-safe token on any platform.
const toRelative = (absolute) => path.relative(MEDIA_ROOT, absolute).split(path.sep).join('/');

module.exports = { MEDIA_DIR, MEDIA_ROOT, resolveMediaPath, toRelative };
