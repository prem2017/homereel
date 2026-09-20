---
name: run-media-player
description: Build, run, and drive the media player (Express + React LAN media server). Use when asked to start or run the app, play a file in a real browser, take a screenshot of the player or library, reproduce or verify a UI or API change (subtitles, search, fullscreen, downloads, resume), or run its tests.
---

Drive the app with `.claude/skills/run-media-player/driver.mjs`. It generates fixture
media, builds `web/` into a scratch dir, starts the real server on 127.0.0.1 and
runs browser commands from stdin in headless Chromium (playwright-core). Paths are
relative to the repo root.

## Prerequisites

Node (the test suites need 20.19+ or 22.12+), npm, ffmpeg. The first run needs the
network: npm fetches playwright-core, and Playwright fetches its Chromium if missing.

```bash
node --version && ffmpeg -version | head -1
```

## Setup

```bash
npm install
```

That is all. The driver builds the frontend into `$TMPDIR/run-media-player/` —
never `web/dist`, which a real `./1_run` instance serves — and installs
playwright-core there, not into the project.

## Run (agent path)

Pipe commands in. The first run takes about a minute (fixtures, build, downloads);
later runs take seconds. The exit code is non-zero if any command or `expect` failed.

```bash
node .claude/skills/run-media-player/driver.mjs <<'EOF'
fake-subtitles
open
play Show/Episode 1.mp4
expect __mp.state().bottomCue === 'Hello from the English file'
select Top Source = Show/Episode 1.srt
expect __mp.state().topCue === 'Café crème, déjà vu'
screenshot dual-subtitles
button Fullscreen
expect __mp.state().fullscreen
key Escape
expect !__mp.state().fullscreen
search bureau legendes
pick Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.1080p.mp4
select Get subtitles = en
button Download
expect __mp.state().bottomCue === 'Fake en subtitle for Le.Bureau.des.Legendes.S01E01.1080p.mp4'
screenshot downloaded
play Dark/Night.mp4
dark video
EOF
```

- Screenshots: `$TMPDIR/run-media-player/shots/NN-<name>.png`, cleared each run. Look
  at them.
- Server log: `$TMPDIR/run-media-player/server.log` — every request, plus
  `[REMOTE ERROR]` lines the page reports.
- Fixtures, copied fresh each run: `Show/Episode 1|2|10.mp4` (40s; Episode 1 has
  `Episode 1.en.srt` in UTF-8 and `Episode 1.srt` in windows-1252),
  `Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.1080p.mp4`,
  `Long/Documentary.mp4` (120s, long enough to resume), `Dark/Night.mp4` (black, for
  `dark`), `Music/Chanson.flac`, `notes.txt` (must stay hidden).

| command | does |
|---|---|
| `open [path]` | load the app, wait for the library |
| `rows` | print the tree as shown (`>` closed, `v` open) |
| `play <path>` | open its folders if closed, click the row, wait until playing |
| `search <words>` · `pick <path>` | header search, print hits as `audio`/`video`; click a hit |
| `button <name>` | reveal the player controls, click the button with that accessible name: `Fullscreen`, `Subtitles`, `Next`, `Download`, `Rescan media folder`… |
| `select <label> = <value>` | open the subtitle panel and choose in `Top Source`, `Bottom Source` or `Get subtitles` |
| `click <sel>` · `fill <sel> = <text>` · `key <Key>` | raw Playwright input |
| `expect <js>` | poll a page expression for up to 5s; `__mp.state()` is available |
| `state` | print `__mp.state()`: playing, time, bottomCue, topCue, fullscreen, alert, continueWatching, panel |
| `eval <js>` | print a page expression |
| `screenshot [name]` · `viewport <w> <h>` | capture; resize (`400 800` gives the phone drawer) |
| `dark <sel>` | while `Dark/Night.mp4` plays: wait for the controls to fade, PASS if nothing bright is painted over the element |
| `sh <cmd>` | shell in the fixture media dir, e.g. `sh cp "Show/Episode 2.mp4" "Show/Episode 3.mp4"` before `button Rescan media folder` |
| `api <path>` · `log [n]` · `console` | GET the server; tail its log; page console errors |
| `fake-subtitles` | answer `/api/subtitles/{languages,search,download}` in the browser; a download writes a real `.srt`. Run it **before** `open` |
| `hold-downloads` · `release-downloads` | park fake downloads, to switch videos mid-download |
| `wait <ms>` · `wait-for <sel>` · `quit` | |

A download that lands after switching videos must leave the new video alone:

```bash
node .claude/skills/run-media-player/driver.mjs <<'EOF'
fake-subtitles
open
play Show/Episode 2.mp4
select Get subtitles = en
hold-downloads
button Download
wait 1000
play Long/Documentary.mp4
release-downloads
wait 1500
expect __mp.state().bottomCue === null
play Show/Episode 2.mp4
expect __mp.state().bottomCue === 'Fake en subtitle for Episode 2.mp4'
EOF
```

API only — `serve` starts the same server without a browser, and `curl` is the driver:

```bash
RUN_MP_PORT=5077 node .claude/skills/run-media-player/driver.mjs serve &
timeout 60 bash -c 'until curl -sf http://127.0.0.1:5077/api/files >/dev/null; do sleep 0.5; done'
curl -s --get --data-urlencode 'q=legendes' http://127.0.0.1:5077/api/search; echo
kill $!
```

Internal code, without the app:

```bash
node -e "console.log(require('./server/subtitles/naming').parseVideoName('Le.Bureau.des.Legendes.S01E05.1080p.mkv'))"
node --test server/subtitles/store.test.js
(cd web && npx vitest run src/utils/resume.test.ts)
```

## Run (human path)

`./0_setup`, then `./1_run` (see README). Agents should not: it serves `web/dist` on
`PORT` from `.env`, 5000 by default, where the user's own instance usually runs.

## Test

```bash
npm test && npm run typecheck
```

Both suites pass (95 server tests, 94 web tests on 2026-09-14) and typecheck prints no errors.

## Gotchas

- **Faded controls are `pointer-events-none`**, so `button` moves the mouse over the
  picture before clicking; a raw `click` on a control-bar button does not.
- **Selecting a file opens its folder**, and open folders persist, so a blind click on
  a folder row can close it. `play` checks `aria-expanded` first.
- **Row ids** are `file-node-` plus the path with every non-alphanumeric turned into
  `_`: `wait-for [id="file-node-Show_Episode_3_mp4"]`; `Légendes` becomes `L_gendes`.
- **Native (bottom) cues are not in the DOM** — `bottomCue` reads `textTracks`, and
  what is actually painted only shows in pixels (`dark`); the top subtitle is a real
  element. Cues start at 0.5s, so `state` straight after `play` shows `null`; assert
  with `expect`, which polls.
- **Continue watching lists a file only after its first position save** (a few seconds
  of playback), and only positions >30s in with >30s left: use `Long/Documentary.mp4`.
- **lucide-react icons have no per-icon class**; a search hit's kind is its colour
  class (`text-purple-400` = audio).
- **Nothing leaves the machine**: the server gets a clean env (no provider keys) and
  `SUBSCENE_URL=http://127.0.0.1:9`, which it refuses to fetch. Download flows go
  through `fake-subtitles`.

## Troubleshooting

- **`ERROR locator.click: Timeout 10000ms exceeded`** on a search hit: it was not in
  the dropdown (the last search was for something else). `pick` right after its
  `search`; it now says `"…" is not in the current search results`.
- **`FATAL:…process_singleton_posix.cc… Socket path too long: …/SingletonSocket`**:
  system Google Chrome launched with a long `TMPDIR`. Playwright's own headless
  Chromium needs no singleton socket and plays H.264/AAC, so the driver uses it; do not
  swap Chrome in.
