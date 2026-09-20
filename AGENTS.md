# CLAUDE.md

Notes for Claude Code working in this repository.

## What this is

A LAN media server: Express streams files from a configured folder, a React UI
browses and plays them. The target is a smart TV's browser on the same Wi-Fi —
reference device a 2017 Samsung MU6100/MU6125 (Tizen 3.0 ≈ Chromium 47).

## Layout

npm **workspaces** `web` and `server`. Always `npm install` at the repo root; a
workspace install nests `node_modules`.

```
0_setup   user entry point: configure + build
1_run     user entry point: start, dispatches on RUN_MODE
x_stop    user entry point: stop either runtime
web/      React + TypeScript + Vite + Tailwind   (ESM)
server/   Express                                 (CommonJS, on purpose)
docker/   Dockerfile + compose.yml
scripts/  run (node path), run-docker, run-dev, lib.sh — never typed by users
```

The `0_`/`1_`/`x_` prefixes sort `ls` into the order a new user needs. Do not add
`"type": "module"` to `server/package.json` without converting its `require`s.

`server/`: `mediaPath.js` (the path guard), `subtitles/` — `hash.js` (moviehash),
`naming.js` (release parsing, ranking), `store.js` (the only writer to the media
folder), `archive.js` (ZIP), `providers/` (one module per source).

## Commands

```bash
./0_setup [--yes]            # write .env, pick a runtime, build (--yes: no prompts, implies consent)
./1_run [--node|--docker] [--port 5050]
./1_run logs                 # Docker only
./x_stop                     # whichever runtime is running

./scripts/run-dev            # Vite + Express with live reload
npm run typecheck            # tsc --noEmit, strict mode; keep it clean
npm test                     # vitest in web (logic only, no DOM) + node --test in server
                             # (includes HTTP tests); needs Node 20.19+ or 22.12+
npm run build                # frontend -> web/dist
```

Config is the root `.env` (template `.env.example`). `MEDIA_DIR` is required and
validated by `scripts/lib.sh`. `RUN_MODE` is written by `0_setup`, read by `1_run`.

**`0_setup` is the only script that touches the system**: it installs Docker only
when neither Docker nor Node 18+ is present, and only after a y/N that prints the
exact commands. Strangers clone this repo; keep it that way.

## The one invariant that matters

**Every filesystem access goes through `resolveMediaPath()` in
`server/mediaPath.js`**, and there is exactly one copy of it. It once checked
`startsWith(MEDIA_ROOT)` on the raw query string and served `/etc/passwd` to the
LAN. Two properties keep that out:

1. API paths are **relative** to `MEDIA_ROOT` (`toRelative()`), never absolute.
2. Containment is checked **after `path.resolve()`**, against `MEDIA_ROOT + path.sep`
   (so `/media-secrets` fails a prefix test).

New endpoint touching the disk → same helper. Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  --get --data-urlencode 'path=/etc/passwd' http://localhost:5000/api/stream   # must be 403
```

403 = escaped the root and blocked; 404 = inside the root, no such file (also safe).

**Writes happen only in `server/subtitles/store.js`**, with five more checks:

- the video must exist and be a media file (`requireVideo`; search and download
  use it too);
- the filename derives from the **video**, never from a provider's `file_name` or
  a ZIP entry name;
- only `.srt` / `.vtt`;
- never overwrite (this is what makes "try another" non-destructive);
- the bytes must contain a cue timing line — a link that 302s to an ad page is HTML
  with HTTP 200.

A season pack is several `saveSubtitle` calls; `planArchive` only pairs entries
with videos, so a video path is still the only thing that names a destination.

**Subtitle text is read through `/api/subtitles/text`** (guarded, size-capped),
which decodes on the server: UTF-16 by BOM, else strict UTF-8, else windows-1252
(`decodeSubtitle`). Not through `/api/stream`: `fetch().text()` only knows UTF-8.

**No CORS.** The UI is same-origin in production and behind the Vite proxy in dev;
`cors()` let any page a LAN user opened read the library and trigger writes. Do
not add it back.

### The name a download is saved under

`server/subtitles/naming.js` owns it, and it is load-bearing:

```
<source>_<video>_<resolution>_<language><counter>.<srt|vtt>
OS_Ford-V-Ferrari_1080p_en1.srt
SD_Au-Service-De-La-France-S01E01_fr3.srt     resolution omitted when unknown
```

- **The counter is the app's memory**: highest on disk for this video and language
  plus one (`countedSoFar`). No state file; counting entries instead would reuse a
  number after a deletion.
- **"Download another" skips what is on disk**: the player passes that count as
  `skip` to `autoFetch`. Downloads are metered; re-fetching costs the user.
- The video segment is the **parsed title** plus `SxxExx` when present (otherwise
  every episode shares a slug and a counter). `_` separates fields and is stripped
  from the slug.
- **Two parsers must agree**: `parseSubtitleFileName` in `naming.js` (counting) and
  in `web/src/utils/subtitleNaming.ts` (listing). The client match is loose on
  purpose; it only decides what a menu lists.
- The player's default pick falls back to the parsed form, since a download's name
  does not start with the video's.
- **Source menus list this video's subtitles only.** `subtitleMatchesVideo()` test
  order is load-bearing: exact `startsWith` → episode marker → title slug. Episode
  before slug because the server's slug mangles accents (`Légendes` → `L-gendes`).
  The marker is read off the unsquashed name (`S01E05` + `1080p` reads as episode
  51). No lookbehind (Chromium 47). While an episode plays, a subtitle without a
  marker does not match.
- **A number in a name must match a whole number** (`wholeAt` in
  `subtitleNaming.ts`, used by both the `startsWith` and the slug test): `Episode 1`
  is not the start of `Episode 10`, and `squash` keeps a gap between two numbers so
  `300.2006` stays two. Without it Episode 1's download was listed, and switched on,
  during Episode 10. Checked on a 715-video library: no listing changed.
- **`Subs/` folders**: `subtitlesFor()` in `web/src/utils/siblings.ts` owns the rule
  (`availableSubtitles` just calls it). A subtitle folder is recognised by content
  (subtitles, no media), never by name; the name test is skipped only when the
  folder holds exactly one video; only subtitles are lifted out, never videos.
  Pinned in `siblings.test.ts`, as is `subtitlesFor` taking the nulls the player
  holds before anything plays.

## Frontend notes

- **Tailwind is compiled.** Sources outside `web/src` need adding to `content`.
- **The legacy build is deliberate**: `@vitejs/plugin-legacy`, `chrome >= 47`. Do
  not remove it; beware dependencies shipping untranspiled syntax.
- **plugin-legacy only transpiles JavaScript.** CSS and DOM APIs are kept to
  Chromium 47 by hand:

  | Missing | Since | Rule here |
  |---|---|---|
  | CSS custom properties (`var()`) | Chrome 49 | `corePlugins` disables the `*Opacity` plugins so colours compile to hex. Never hand-write `var()`. |
  | `rgb(a b c / d)` | Chrome 65 | `build.cssTarget: 'chrome47'` lowers it to `rgba()`. |
  | flexbox `gap` | Chrome 84 | `space-x-*` / `space-y-*`. **No `gap-*`.** |
  | `:focus-visible` | Chrome 86 | Plain `focus:`. |
  | `KeyboardEvent.key` | Chrome 51 | `normalizeKey()` in `utils/keys.ts`. |
  | `play()` returning a promise | Chrome 50 | `safePlay()` in `utils/media.ts`. **Never `.play().catch()`.** |
  | Unprefixed Fullscreen API | Chrome 71 | `fullscreenElement()` in `utils/media.ts`; request/exit try each prefix. |
  | `:where()` / `:is()` | Chrome 88 | One drops the **whole rule**; `index.css` restates Preflight's button reset. Never write them. |

  `browserslist` in `web/package.json` must match `targets` in `vite.config.ts`.

  Tailwind still emits `var()` for rings, shadows, gradients and transforms. They
  degrade to nothing, so nothing may be visible *only* through them (fallbacks:
  `.gradient-text` in `index.css`, the `bg-black/70` scrim under the control bar).
  **`-translate-x-1/2` is one of them** — centre toasts with a full-width
  `flex justify-center` row, never `left-1/2 -translate-x-1/2`.
- **Remote navigation is a feature.** File rows and search results are real
  `<button>`s (`role="treeitem"`, roving `tabIndex`, one delegated key handler in
  `FileTree`). Never `<div onClick>`.
- **A hidden control is gone**: `opacity-0` always comes with `pointer-events-none`
  (else it eats clicks and stays in the tab order); the click overlay is
  `cursor-none` while controls are hidden.
- **Sidebar**: resizable column above `NARROW_WIDTH` (768px), drawer below. Only the
  header toggle writes its open state to `prefs`; crossing the threshold re-reads it.
- **Shortcut sheet**: `SHORTCUTS`/`GESTURES` sit beside their handlers in
  `MediaPlayer.tsx`. It opens on `?` and on a control-bar button — the TV cannot
  report the Shift that `?` needs.
- **Panels over the film close on a click past them** (a `document` listener
  bounded by the wrapper ref). `handleContainerClick` returns early while the
  subtitle panel is open, so dismissing it does not also pause. Escape order: help
  sheet → subtitle panel → fullscreen.
- **The library lists media only** (`filterTree` in `FileTree.tsx`; `searchTree` in
  `server/index.js` applies the same rule to `all`). `/api/files` still returns
  subtitles: `findSiblings` reads the unfiltered tree to fill the Source menus, and
  handles files at the library root (a flat top-level array).
- **Search** requires every word of the query in the file's path, compared without
  accents or punctuation (`searchKey`), so folder names and `Le.Bureau.des.Legendes`
  match. Listings are sorted with a numeric collator (Episode 2 before Episode 10).
- **The tree is fetched at load, by the rescan button, and when a search hit is not
  in it** (`loadLibrary`). A rescan keeps the current tree on screen. The player's
  siblings are a `useMemo` over the tree, so a rescan reaches its menus and Next.
- `playableSiblings` in `App.tsx` uses `isPlayable`: Next/Previous step only through
  what the library lists, never a release folder's `.nfo`/`.txt`.
- **No mock data.** Failures surface as `loadError` / `searchError`. A fake tree
  once made a broken `MEDIA_DIR` look fine.
- **Loading is a third state**: `loading → loadError → empty → tree`. Without it a
  slow first scan reads as an empty library. Same for any new async list.
- `services/api.ts` throws with the server's own `error` field, so messages reach a
  TV with no devtools.
- **Crashes are contained and reported.** `ErrorBoundary` wraps the app and,
  separately, the player (reset by file path, so picking another file retries).
  `main.tsx` registers `error`/`unhandledrejection` before the first render. All
  report through `reportToServer` (`utils/remoteLog.ts`).
- **A reply that lands after the user switched videos changes nothing on screen.**
  `useSubtitleDownload` (`openRef`) and `applySubtitle` (`filePathRef`) compare
  against the video open now: late candidates are not offered, and a late download
  is saved and listed for its own video but never fills the new one's slot.

## What the app remembers

All `localStorage`, all through `createNumberStore`/`createStringStore` in
`web/src/utils/localNumbers.ts`. The stores swallow their own errors — private mode
and a full quota must never break playback.

| Store | Key | Written by |
|---|---|---|
| `media-player:resume` | file path → seconds | the player, every 5s and on ended (cleared) |
| `media-player:duration` | file path → seconds | `loadedmetadata` |
| `media-player:subtitle-offset` | subtitle path → seconds | the sync buttons |
| `media-player:subtitle-top` | video path → subtitle path | the Top Source menu |
| `media-player:subtitle-bottom` | video path → subtitle path | the Bottom Source menu, and a download that filled an empty slot |
| `media-player:open-folders` | folder path → 1 | `FileTree`, as a set |
| `media-player:prefs` | fixed keys → number | volume, mute, speed, both font sizes, sidebar width and open state |

- **Insertion order is recency** (`write` deletes, then sets): "continue watching" is
  that order reversed, and trimming is LRU.
- **Continue watching offers only what pressing it would resume** — `isResumable()`
  in `utils/resume.ts`: past 30s and not within 30s of the end — plus the file
  playing. The player resumes by the same helper.
- Position and duration are separate stores: seconds to resume, the pair for a bar.
  No duration, no bar.
- **The library reads, the player writes.** `App` re-reads on selection and on the
  player's `onProgress` (save cadence), so what is playing is listed with a moving
  bar. `React.memo` on `MediaPlayer` and number-valued rows pay for that re-render.
- **Resume saves on distance**: `Math.abs(t - lastSavedRef.current) >= RESUME_SAVE_EVERY`,
  so a rewind is saved too.
- **Subtitle choice → video, offset → subtitle file, font size → room.** Only
  deliberate choices are recorded (the Source menus; a download that filled an empty
  slot). A read returns a node, `null` for a deliberate Off (stored as `''` — never
  treat `''` as a deletion), or `undefined` (never chose, or the file is gone).
- The `::cue` effect is keyed `[bottomFontSize, filePath, showControls]`: its
  `<style>` element exists only while something is playing.
- Volume must be written onto the media element, not only into state, or a new file
  plays at full volume.

## Dev vs production serving

- **Production**: Express serves the API and `WEB_DIST` (default `web/dist`; Docker
  `/app/web/dist`) on one port. `scripts/run` sets `NODE_ENV=production` (no stack
  traces in error pages) on the server's line only — npm reads it too and would
  skip the build tools.
- **Development**: Vite on `WEB_DEV_PORT` proxies `/api` to Express on `PORT`. Open
  the Vite port.
- Both bind `0.0.0.0`; the TV needs that.

## Docker notes

- Build context is the **repo root**; `scripts/run-docker` passes
  `--project-directory` so Compose reads the root `.env`. A bare
  `docker compose -f docker/compose.yml up` does not.
- `.dockerignore` must sit at the repo root, or all of `node_modules` is uploaded.
- The Dockerfile uses `npm ci`: keep `package-lock.json` committed and in sync
  (`npm install` at the root after any manifest change).
- A container cannot know the host's LAN IP; `scripts/run-docker` prints it
  (`detect_lan_ip`).

## Subtitle downloading

Off by default: with no keys the endpoints answer, every provider reports
unconfigured, and the player behaves as if the feature did not exist. Nobody should
need an account to watch their own files.

- **Ranking is by match quality, never by source.** `rankCandidates()` tiers hash
  match → exact release → title; `SUBTITLE_PROVIDERS` order breaks ties within a
  tier only. A hash match is in sync; a title match is a guess. Pinned in
  `naming.test.js`.
- **Providers are queried in parallel** — in sequence, the first source would decide.
- **Search is free, download is metered**: two endpoints, two calls. Do not merge.
- **Key settings take comma-separated lists**, rotated by `keyring.js`:
  - spent (406/429) returns at `reset_time_utc`; rejected (401/403) stays out until
    restart, with its reason shown;
  - any other error (500, timeout) propagates from the first key — never rotates;
  - search runs `metered: false`, so a spent key still searches;
  - only the authenticated call is wrapped — a 403 on the CDN link is a dead link;
  - state is in memory only.
- **A failing provider never fails the search**: it goes into `unavailable`, which
  the UI flashes.
- **An archive can be a whole season.** `archive.js` lists and reads in two calls
  (`listSubtitleEntries`, `extractEntry`); `planArchive` in `subtitles/index.js`
  picks the entry by episode marker (`parseVideoName`, so `S01E05` and `1x05`),
  saves the other entries for matching videos in the folder (one per episode), and
  errors — naming what it holds — when the playing episode is missing. Never
  substitute. Pinned in `index.test.js`.
- **Everything a download wrote goes up through `onSubtitlesSaved`** (a required
  prop) and is merged in `App`. Do not refetch `/api/files` for it mid-playback.
- **A download's language is a fact about the file**: `declared || requested ||
  detected || 'un'`. Declared: `languageOfPage` in `subscene.js` reads the *end* of
  the page title, then the archive name. Requested: the menu, a fallback only.
  Detected: `detectLanguage` matches whole language names, never codes (`_HI_` is
  hearing-impaired, not Hindi).
- **`sub-scene.com` is download-by-id only. Read this before touching it.** It is a
  clone of the defunct subscene.com with no API: `/subtitle/<id>` is open, but
  `/search?query=` answers 403 `cf-mitigated: challenge`, and this project does not
  defeat bot detection. So `search()` returns `[]` (an error would flag it
  unavailable on every search) and `download(ref)` takes an id the user typed.
  Re-probe `/search?query=` before adding search.
  - It is **standalone** — not part of `SUBTITLE_PROVIDERS` (`providers/index.js`
    splits `SEARCHABLE` from `STANDALONE`). On that list it could only ever mean
    "may the ID box work", which nobody would look for. `resolveProviders()` skips
    a leftover `subscene` silently. Pinned in `providers/index.test.js`.
  - **`SUBSCENE_URL` is its whole config**, with a working default: no account, no
    traffic until an id is typed. Empty = off; unset = default (hence
    `${SUBSCENE_URL-…}` in `compose.yml`). The old `SUBSCENE_BASE_URL` is still read
    on the node path with a warning (`ponytail:` in `config.js`).
  - **The ID box is never hidden**: when off it is disabled with the reason, and its
    label shows the configured host.
  - **A dead domain is not a dead id.** `fetchPage` reports any fetch failure as
    `unreachable`, naming the host and `SUBSCENE_URL`; a 200 without an archive link
    is the id's fault. `check()` returns both as verdicts.
  - The scraped archive link's host must be in `DOWNLOAD_HOSTS` (plus
    `SUBSCENE_URL`'s host) — a constant, not a setting.
  - `assertFetchable` in `http.js` backs every provider: it refuses non-http(s) and
    loopback, RFC1918 and link-local hosts (literal hosts only; DNS rebinding is
    marked as the upgrade path).
- **An id is checked before Get is offered, with the download's own `fetchPage`** — a
  page without a file and a redirect to the front page are both HTTP 200. Only
  free-lookup sources may implement `check`; the client waits for ≥5 characters and
  a pause (`MIN_CHECKED_LENGTH`, `useSubsceneId.ts`); a check that cannot run
  (`unchecked`) leaves Get enabled.
- **An id fetched this session is not fetched again**: `reusableSubtitle()` turns
  Get into **Use it**. It answers with the file for the video *playing* (a pack
  taken during episode 1 offers episode 5's file), falls through to a real download
  when the pack wrote nothing for this video, says "this session" (the name on disk
  does not record the id), and fills an empty slot only, like a download. Pinned in
  `useSubtitleDownload.test.ts`.
- Server tests use **`node:test`**; do not add a test dependency to `server/`.
  `server/index.test.js` drives the real app over HTTP against a scratch
  `MEDIA_DIR`; `index.js` only listens when run directly.

## Gotchas

- **Autoplay-next goes through a toast.** `handleEnded` sets `upNextIn` only when
  there is a `nextName`; an effect counts it down, then `onEnded` fires. Without a
  `nextName` it jumps at once (right for the last file).
- **`FileTree`'s root is `flex-1 min-h-0`, not `h-full`**, or the last rows hang off
  screen beside its sidebar siblings. Same trap for the details card under the player.
- `scripts/run-dev` backgrounds both processes and `wait`s: bash defers traps during
  a foreground command, which orphaned the API on Ctrl+C. `kill_tree` walks children
  (npm spawns Vite as a grandchild).
- `scripts/run` rebuilds only when `web/dist/index.html` is missing or older than
  `web/src`, `web/index.html` or `web/vite.config.ts`.
- The file scan is synchronous and reruns on every `/api/files` and `/api/search` —
  fine for thousands of files, blocks well before 50k (`ponytail:` in `server/index.js`).
- `/api/stream` uses `sendFile()` → `stream.pipeline()`. Never `.pipe(res)`: it leaks
  one fd per aborted request, i.e. per seek.
- **`video.play()` goes through `safePlay()`.** Before Chrome 50 it returned
  `undefined`; `.play().catch()` threw and blacked out every file on the TV while the
  symptom pointed at codecs. Pinned in `media.test.ts`.
- **`canPlayType()` is a hint.** Samsung answers `''` for mkv, then plays it.
  `formatWarning` is retracted on `onLoadedData`; never make it blocking.
- **`index.html` is served `no-store`, hashed assets `immutable`.** SamsungBrowser 2.0
  reuses stale copies under `max-age=0`. Logs showing `/api/files` but never `/` or
  `/assets/*.js` mean a stale cache, not a broken fix; one load of
  `http://<ip>:5000/?v=2` breaks out.
- **`/api/log` is the TV's only error channel** — `[REMOTE ERROR]` lines in
  `./1_run logs`. Do not remove it. It coerces and caps its untrusted input.
- **Subtitle sync is two mechanisms.** Top overlay: `cueAt(cues, t - topOffset)`.
  Bottom native `<track>`: `toVttBlob()` rewrites the timings and the track is
  remounted, so `appliedBottomOffset` trails by `OFFSET_COMMIT_MS` (otherwise every
  tap reparses and blinks). Do not mutate `cue.startTime` instead — old Blink does not
  re-sort, and that cannot be verified without the TV. Only `-->` lines are rewritten.
  Pinned in `subtitleParser.test.ts`.
- **The `<track>` renders only while the file its blob was built for is open**
  (`bottomSubtitleSrc.filePath`), so a file switch removes it in the same commit that
  changes `src`, and first — React removes children before updating their parent.
  Removed afterwards by the reset effects, Blink kept the old cue painted over the
  next video. `dark` in the run-media-player skill checks for it.
- **The Source menus have one source of truth, the `siblings` prop.**
  `availableSubtitles` is a `useMemo`, never state (two writers once lost a season
  pack's own file). `applySubtitle` sends `[node, ...extras]` up;
  `handleSubtitlesSaved` returns the *same* array when nothing is new; slot clearing
  is keyed on `filePath` alone.
- **The bottom cue is moved clear of overlays** through
  `video::-webkit-media-text-track-container { transform: translate(-<shift>px, -<lift>px) }`
  (`::cue` cannot move the box):
  - lift is the `max()` (not the sum) of the measured clearance of each overlay in
    the bottom strip (`controlBarRef`, `resumeNoticeRef`, `upNextRef`) and the
    letterbox bar. **A new overlay there needs its ref added.**
  - shift is measured off the subtitle panel **body**, not `subPanelRef` (that wrapper
    measures only the toggle button);
  - `pictureGeometry()` is the one measurement of the picture drawn inside the
    `object-contain` element; `known` is false until `loadedmetadata`, and always for
    `<audio>`;
  - `PICTURE_EDGE_MARGIN` insets both subtitles by a fraction of the picture height.
    Do not bring back a margin slider in place of measuring;
  - the top overlay is placed by a callback ref — it mounts per cue, and a style prop
    would re-render the memoized player on every resize;
  - `writeCueStyle` reruns on `resize`, `orientationchange`, `loadedmetadata` and the
    four `fullscreenchange` events; `isFullscreen` state changes before the resize.
    No `ResizeObserver` (Chrome 64).
- **`CUE_LINE_HEIGHT` (1.2) closes the gap between native cue lines.** `::cue` is
  inline, so each line paints its own background, and the gap depends on the device's
  fonts (Devanagari fallbacks are taller). Copying the overlay's `leading-relaxed`
  made it worse. It is repeated in px on `-webkit-media-text-track-display` to pin
  the strut. `padding`/`border-radius` are ignored on `::cue`; no Tailwind transforms
  there (`var()`).
- **Playback time goes to the DOM, not state** (`handleTimeUpdate` writes
  `progressRef`/`timeLabelRef`). A `useState` there re-renders the player 4×/s.
- **`MediaPlayer` is `React.memo`; every prop must keep its identity** —
  `onNext`, `onPrevious`, `onProgress`, `onEnded`, `onSubtitlesSaved` are
  `useCallback`s in `App.tsx`, `siblings` is the memoized `siblingsWithSaved`.
- The `::cue` `<style>` is mutated through `styleRef`, not rendered as JSX (that
  invalidated the CSSOM on every render).
- Callbacks that outlive a render read refs (`isPlayingRef`, `showSubSettingsRef`,
  `filePathRef`), not state.
- `FileTree` flattens the tree and keeps expansion in one `Set`; `handleSelectFile`
  stays a `useCallback`, or the row memo is inert.
- Side-of-screen clicks are **optimistic**: the first toggles play at once, a second
  within 300ms reverts it and skips ±10s, a third adds ±5s. There is no triple-click
  event, and waiting would delay every click.
- `MAX_DEPTH` stops the scanner looping on symlinks.
- Scripts: no statement-level `A || B && C` under `set -e` (aborts when both fail);
  use `if`.
- `compose.yml` pins `container_name: media-player`; `clear_orphan_container` in
  `scripts/run-docker` offers to remove a leftover manual container. **Ask Compose
  what it owns (`compose ps -aq`)**, never the `com.docker.compose.*` labels —
  containers inherit them from the image. `compose ps -q` prints full IDs, hence
  `--no-trunc` on the `docker ps` side. `CONTAINER_NAME` in `scripts/lib.sh` must
  match `container_name`.
- `load_env` restores variables already set in the shell after sourcing `.env`, or
  `PORT=8080 ./1_run` is silently ignored. Add new settings to its restore list.
- `require_free_port` (Node path only) binds to probe and names the holder:
  `docker ps --filter publish=` first (`ss` shows no owner for `docker-proxy`), and
  `ps -o args=` (Node's `comm` is `MainThread`).
- `x_stop` stops both runtimes (so neither `1_run` nor `run-docker` has a stop). It
  uses `docker stop`, not `compose down` (works when `MEDIA_DIR` is gone), finds the
  Node server by its `server/index.js` path (never by port), and refuses a
  `node --watch` group — that is `run-dev`. Test the whole group: the watcher's child
  has no `--watch`.

## Known follow-ups

Not addressed, deliberately:

- **Vite 4 pulls a vulnerable esbuild** (GHSA-67mh-4wv8-2f99, dev server only, not in
  the bundle). The fix is Vite 6.4.3+/7 plus a new `@vitejs/plugin-legacy`, which
  cannot be verified without the TV — that is also what `npm audit fix --force` does.
- **The container runs as root with a writable media mount.** Writes are bounded by
  `store.js`; the upgrade path is `user: "${UID}:${GID}"` in `compose.yml`
  (`ponytail:` in `docker/Dockerfile`).
- **Scraped search.** The provider interface (`configured`, `search`, `download`,
  optional `check`) makes an API source small to add; a source whose search needs
  bot detection defeated is not a candidate.
- **Choosing an audio track is impossible in the browser** (no `audioTracks` in
  Chromium). The only route is server-side remux-to-cache: `ffprobe`, then
  `ffmpeg -map 0:a:<n> -c copy` into a cache served by `/api/stream`. Never pipe
  ffmpeg to the response (no byte ranges). Costs ffmpeg in the image and a guarded
  write path outside `MEDIA_DIR`.
- `SUPPORTED_*_EXTENSIONS` in `web/src/constants.ts` are exported but unused.
