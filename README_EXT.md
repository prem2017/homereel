# HomeReel: the full guide

The [README](README.md) is the short version. This is everything else: a tour
with screenshots, the controls, subtitles, every setting, and what to do when
something goes wrong.

The screenshots were taken with the project's test driver against a demo library
of generated clips, named after the Blender open movies.

## Contents

- [What it does](#what-it-does)
- [What it does not do](#what-it-does-not-do)
- [Installing and running](#installing-and-running)
- [A tour](#a-tour)
- [Keys, remote and mouse](#keys-remote-and-mouse)
- [What it remembers](#what-it-remembers)
- [Subtitles](#subtitles)
- [Docker](#docker)
- [Configuration](#configuration)
- [Development](#development)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## What it does

- A Home screen with what you were watching, the next episode, and what is new
- Your folders as a library with readable names (*Episode 2 · S01E02*, not
  `Le.Bureau.des.Legendes.S01E02.1080p.mp4`), and a search you can use from the keyboard
- Video and audio playback with keyboard and remote controls, and a Now playing
  view for music
- Subtitles, including `.srt` files (converted on the fly), two at once — top and
  bottom — and your languages remembered
- Optionally download missing subtitles by language — see [Subtitles](#subtitles)
- Remembers where you stopped and what you finished, and carries on into the next
  episode, or the next season
- Works on a phone too, with lock-screen controls and Add to Home Screen
- Large text for reading from the sofa
- Seeking works properly on large files, via HTTP range requests
- Built for old smart-TV browsers, which are usually years behind desktop Chrome —
  the reference is a 2017 Samsung, whose browser is roughly Chrome 47

## What it does not do

Worth knowing before you install it:

- **No transcoding.** Files are streamed as they are, so your TV's browser has
  to understand the codec itself. MP4 (H.264 + AAC) is the safe bet. Many TVs
  refuse MKV, H.265/HEVC, or DTS audio. If a file lists but will not play, this
  is almost always why.
- **No authentication.** Anyone who can reach your computer on the network can
  browse and play your media. That is fine on a home Wi-Fi network. Do not
  forward this port to the internet.
- **No choice of audio track.** A file with several audio languages plays its
  default one; browsers give a page no way to pick another.
- **No syncing between devices.** Where you stopped, what you finished and your
  settings are kept by the browser you watched in, so the TV and your laptop each
  keep their own. See [What it remembers](#what-it-remembers).

## Installing and running

### Quick start

```bash
git clone https://github.com/prem2017/homereel.git
cd homereel

./0_setup      # asks where your media is, then gets everything ready
./1_run        # starts it
./x_stop       # stops it
```

That is the whole thing. `0_setup` is a one-time step; after that you only ever
need `./1_run` and `./x_stop`.

### What `0_setup` does

1. Asks which folder holds your media, and writes your answer to `.env`
2. Looks for **Docker** or **Node.js 18+**, and uses whichever you have
3. Builds the application

If you have *neither*, it explains what it would install, shows you the exact
commands, and asks for permission first. Answer `n` and it stops without
touching your system. Nothing is ever installed behind your back.

Run it without prompts using `./0_setup --yes`.

### Requirements

You need **one** of these — `0_setup` will offer to install Docker if you have
neither:

- **Docker** — bundles everything, nothing else to install
- **Node.js 18 or newer** ([nodejs.org](https://nodejs.org))

### Starting and stopping

```bash
./1_run                 # start
./x_stop                # stop, whichever way it is running
./1_run logs            # follow the logs            (Docker only)

./1_run --node          # force running with Node.js
./1_run --docker        # force running in Docker
./1_run --port 5050     # use a different port, just this once
```

In Node mode the app runs in your terminal, so leave the window open while you
are watching — `Ctrl+C` stops it. In Docker mode it runs in the background and
survives closing the terminal. Either way `./x_stop` stops it.

When you start it, you will see:

```
  HomeReel is running

  Serving media from : /home/you/Videos
  On this computer   : http://localhost:5000
  On your TV / phone : http://192.168.1.21:5000
```

### Watching on your TV

1. Make sure the TV is on the **same Wi-Fi network** as your computer.
2. Open the TV's web browser.
3. Type in the `On your TV / phone` address printed above — including the
   `:5000` at the end.

Leave the terminal running; closing it stops the server.

If the page will not load, see [Troubleshooting](#troubleshooting).

## A tour

### Home

![Home: Continue watching, Recently added, and the library](docs/images/home.png)

Home is what you see while nothing is playing:

- **Continue watching** — what you were in the middle of, with a bar for how far
  you got, and the next episode of a show whose last episode you finished.
- **Recently added** — newest first. An album, or a show's new episodes, make one
  card rather than a dozen.
- **Browse** — a tile for each top-level folder, which opens it in the library.

Cards use the artwork already in your folders, by the names Kodi, Plex and
Jellyfin use: `poster`, `folder`, `cover`, `front` or `album` (`.jpg`, `.png` or
`.webp`) in a folder, or an image named after a single file beside it
(`Film.jpg`, `Film-poster.jpg`). Anything without one gets a coloured tile with
its name.

The **HomeReel** name at the top left always brings you back here, and whatever
was playing is saved where you left it.

### The library

The column on the left is your media folder, video and audio only — subtitles and
everything else stay out of the way. Each row says what tells it apart from its
neighbours:

| You see | It means |
|---|---|
| **Episode 2** `S01E02` | the episode, read from a name like `Le.Bureau.des.Legendes.S01E02.1080p.mp4` |
| **Sintel** `720p`, **Cosmos Laundromat** `2015` | a film's title, with its resolution or year |
| an amber `HEVC` or `MKV` | a format TVs often refuse — see [What it does not do](#what-it-does-not-do) |
| ✓ | you finished it |
| a blue line under the name | how far you got |

The tooltip shows the name on disk. Drag the column's edge to make it wider. New
files show up within a minute; the button beside **Library** looks straight away.

With a keyboard, Up and Down move between rows, Right opens a folder, Left closes
it (or steps out to the folder above), and Enter plays.

### Search

![Search results grouped by folder, with the All / Video / Audio filter](docs/images/search.png)

Type two letters or more into the box at the top. Every word has to appear
somewhere in the file's path, so a folder's name counts, and accents and
punctuation are ignored: `legendes` finds `Le.Bureau.des.Légendes`.

Results are grouped by folder with your words in bold. **All**, **Video** and
**Audio** at the top filter them, each with its count. From the keyboard, Down
moves into the results, Up and Down step through them, Enter plays, and Escape
closes the list. At most 50 are shown; keep typing to narrow it down.

### The player

![The player: two subtitles, the control bar, and the info line underneath](docs/images/dual-subtitles-demo.png)

The bar along the bottom of the picture:

- **The seek bar** shows how much has loaded, and under the pointer, the time you
  would jump to.
- **The total time** on the right switches to the time left when you press it.
- **The subtitle button** names the languages that are on (*EN · FR*) and opens
  the [subtitle panel](#subtitles).
- **The speed chip** steps through 0.5× to 2×, and lights up when it is not 1×.
- **The keyboard button** lists every shortcut — the TV's way to see them.
- **Fullscreen.** Music has neither this nor the subtitle button.

Under the picture, a line gives the folder (press it to find the file in the
library), the film's tidied title, what its name says (year, resolution, source)
and its size, and which subtitles are showing where.

A file you stopped part-way through starts where you left it, with a **Start
over** button in case you wanted the beginning. Anything less than 30 seconds in,
or within 30 seconds of the end, starts from the top.

### Up next, and the next season

![The Up next card at the end of a season: Episode 1 of Season 2](docs/images/up-next.png)

At the end of an episode, a card names what comes next and counts down six
seconds. **Play now** goes straight away; **Stay here** cancels. At the end of a
season folder (*Season 1*, *S01*), it carries on into the first episode of the
next season beside it, and says so. The last file in a folder just stops.

Music does not wait: an album plays straight through, track after track.

### Music

![Now playing: the album cover, the track, and the album's tracks](docs/images/now-playing.png)

Audio gets a Now playing view: the album's cover (`cover`, `folder`, `front`,
`album` or `poster` beside the tracks), the title without its track number, the
album from the folder's name, *Track 2 of 3*, and the folder's tracks with their
lengths. Pick a track to play it.

On a phone, the lock screen shows the track, album and cover, with play, pause,
next and previous.

### When a file will not play

![A file that will not play: what went wrong, what would fix it, and what to do now](docs/images/playback-problem.png)

The player says why in plain words, with advice that follows the file's format,
and offers **Show in library**, **Try again**, and **Play next** when there is a
next file. The amber `HEVC` / `MKV` mark in the library is the same warning,
before you try.

To tell a TV limitation from a fault here, play the same file in a desktop
browser: if it plays there, it is the TV.

### Large text for the TV

![Text at 150%: everything larger, the library column wider](docs/images/large-text.png)

**Aa** at the top right cycles the text size: 100%, 125%, 150%. Everything grows
with it, the library column included. Each browser remembers its own, so the TV
keeps large text while your laptop stays as it is. Subtitles have their own sizes,
in the subtitle panel. Phones have their own zoom, so the button is not shown there.

### On a phone

<img src="docs/images/phone.png" width="260" align="right" alt="HomeReel on a phone: the episode playing, its details, and the next episodes">

Open the same address in your phone's browser. The controls sit on the picture —
play and the 10-second skips in the middle, the time and **Fullscreen** along the
bottom, the seek bar on the edge — and mute, speed and the shortcut list are in
the **⋯** menu. The library is behind the button at the top left, and under the
film you get its details, the next episodes and whatever else you were watching.

Use your browser's **Add to Home Screen** and HomeReel opens full screen, like an
app. The lock screen shows what is playing, with play, pause, next and previous.

<br clear="right">

## Keys, remote and mouse

### The TV remote

On a Samsung remote, the arrows move a pointer, so everything in HomeReel is a
button you can point at and press. In the player, the remote's media keys work:

| Remote key | Does |
|---|---|
| Play/Pause, Play, Pause | what they say |
| Stop | stops, back at the start |
| Rewind / Fast-forward | 10 seconds back or forward |
| Back | closes the shortcut list or the subtitle panel, or leaves fullscreen |

The volume buttons are the TV's own. The keyboard button in the control bar
lists the shortcuts below.

### A keyboard

| Key | Does |
|---|---|
| `Space` | Play or pause |
| `←` / `→` | Back or forward 5 seconds |
| `↑` / `↓` | Volume |
| `m` | Mute |
| `f` | Fullscreen (`Esc` leaves it) |
| `n` / `p` | Next or previous file in the folder |
| `g` / `h` | Subtitle 0.1s earlier or later |
| `c` | Bottom subtitle off, or back on |
| `t` | Top subtitle off, or back on |
| `0` – `9` | Jump to that tenth of the file |
| `?` | The list of shortcuts |

`Tab` moves between the controls, with a clear outline around the one in focus.
The outline goes away at the next mouse click or tap.

### A mouse or a finger

| On the picture | Does |
|---|---|
| Click the middle | Play or pause |
| Double-click a side | Skip 10 seconds that way |
| Triple-click a side | Skip 15 seconds that way |

## What it remembers

Everything is kept by the browser you watch in — its local storage — with no
account and nothing on the server. Each device keeps its own:

- where you stopped in each file, and which files you finished;
- which subtitle you chose for the top and for the bottom of each film, and each
  subtitle's sync shift;
- the subtitle languages you pick, used for every film after;
- volume, mute, speed, both subtitle sizes, the text size, the library column's
  width and whether it is shown, and whether the clock shows the time left;
- which library folders are open.

Clearing the browser's data for the site forgets all of it.

## Subtitles

Two separate things here, and only the second one needs any setup.

![The subtitle panel: a card each for top and bottom, Swap, and Find more online](docs/images/subtitle-panel.png)

**Subtitle files already sitting next to your videos** just work. Any `.srt` or
`.vtt` in the same folder is listed in the player's subtitle menus, and one in
your language — or else one named like the video — is picked automatically. `.srt`
is converted on the fly. Nothing to configure, no account, no internet.

A `Subs/` folder is read as well — the layout most downloads arrive in:

```
Kantara A Legend Chapter 1 (2025) 1080p WEBRip 5.1-WORLD/
├── Kantara.A.Legend.Chapter.1.2025.1080p.WEBRip.x264.AAC5.1-WORLD.mp4
└── Subs/
    ├── kan.srt
    └── kantara.srt        ← both offered in the menus
```

Any subfolder holding subtitles and no video counts, whatever it is called, and
its subtitles are offered without needing to match the film's name — there is
only one film there for them to belong to. If the folder holds a whole season
instead, names matter again and each episode is offered only its own subtitles,
so episode 1's dialogue can never turn up under episode 5.

**Downloading subtitles you do not have** is optional, and off until you add an
API key. Without one the menus still list your local files exactly as above —
only the "search online" part is missing. Nobody should have to register for
anything to watch a file off their own disk.

With a key, the player's subtitle panel gains a **Find more online** section: pick a
language, press **Download**, and the best match is fetched and loaded. Press
**Browse** instead to see the candidates first and choose one yourself.

Downloading and displaying are two separate steps, which is why there are two
sets of menus:

| Menu | What it does |
|---|---|
| **Get subtitles** (under Find more online) | Fetches a subtitle file into the video's folder. |
| **Top** / **Bottom** | Chooses which file to show, and where. Lists the subtitles belonging to the video you are playing — what you downloaded and what was already there, each saying what it is (*English · named like the film*, *French · Subs/French.srt*). In a season folder that means this episode's, not the whole series'. |

So you can hold several subtitles for one film and switch between them without
downloading anything again, or put two languages on screen at once — one at the
top, one at the bottom, as in the [player](#the-player) screenshot. **Swap top and
bottom** trades them over, and each slot has its own size and sync.

The languages you pick are remembered for every film, not just this one: open a
new episode and the bottom slot starts in your language — and the top one in
yours, if you watch with two. A choice you made for a particular film still wins.
On a keyboard, `c` switches the bottom subtitle off and back on, and `t` the top
one.

**If the first one is a poor match, just press Download again.** It skips past
what you already have and takes the next-best candidate, so you never pay twice
for the same file. The panel lists what is already downloaded in that language,
so you can see what a second press will cost you.

Downloads are saved next to the video like this:

```
OS_Ford-V-Ferrari_1080p_en1.srt
└┬┘ └─────┬──────┘ └─┬─┘ └┬┘└┬┘
 │        │          │    │  └─ how many you have in this language
 │        │          │    └──── language
 │        │          └───────── resolution, when the file name says
 │        └──────────────────── the film
 └───────────────────────────── where it came from (OS, SD, SS)
```

Nothing is ever overwritten, so trying a second subtitle never costs you the
first — and deleting one you did not like is enough to make the app forget it.

### When a subtitle runs early or late

Under each slot's menu is a **Sync** row:

```
Sync   ‹ Earlier    +1.5s    Later ›
```

**Earlier** shows the subtitles earlier, **Later** later, half a second at a time.
The middle button is the current shift and resets it. On a keyboard, `g` and `h` do
the same in finer 0.1s steps.

Each subtitle has its own shift, and it is **remembered** — come back to the same
film tomorrow and it is still lined up. Deleting the subtitle or resetting it to
`0.0s` forgets it.

You will mostly need this on subtitles matched by title rather than by file hash.
A hash match was timed against your exact copy and is already in sync; a title
match is a guess about which rip you have, and a guess can be a second or two out.

One thing this cannot fix: a subtitle that starts in sync and drifts further out
as the film goes on. That is a frame-rate mismatch rather than a delay, and no
single shift lines it up. Downloading a different one is the fix.

### Getting an OpenSubtitles key

This is the one worth having. It is the only source that can match on a hash of
the video file itself, which means the subtitle it finds was timed against your
exact copy and will be in sync — rather than being a guess about which rip you
have.

1. **Register at [opensubtitles.com](https://www.opensubtitles.com/en/users/sign_up).**
   Note the `.com` — the older `opensubtitles.org` is a different site with a
   different API, and its keys will not work here.
2. **Confirm the verification email.** The next page stays locked until you do.
3. Go to **[API consumers](https://www.opensubtitles.com/en/consumers)** and
   click **New consumer**.
4. Fill the form as below, then submit. There is no review step — the key is
   issued immediately.

![The OpenSubtitles new-consumer form](docs/images/opensubtitles-consumer.png)

Three things about that form, each of which catches people out:

- **The name must be alphanumeric and unique across the whole site.** The
  screenshot above is showing `Is invalid` for exactly one reason: the hyphen in
  `media-player`. Something like `yournamemediaplayer` clears both rules at once.
  The name has no effect on the app — nothing sends it.
- **"Allow anonymous downloads" must be checked.** This app authenticates with
  the API key alone and never sends a JWT, so with that box unchecked every
  download returns 401. See the Troubleshooting entry below for what that looks
  like, because the symptom is misleading.
- **"Under dev" raises the anonymous limit from 5 downloads a day to 100.** Five
  is barely two films with one retry. This flag is intended for consumers still
  in development; a personal player on your own network is a reasonable fit, but
  it is their flag and they can reset it.

Copy the key from the consumers page into `.env`:

```bash
OPENSUBTITLES_API_KEY=your_key_here
```

Then restart with `./1_run`. A restart is required — reloading the browser page
will not pick up a new key, and under Docker the container only reads `.env` when
it starts.

### Getting a SubDL key

Optional, and genuinely optional — skip it unless you want a backup.

Register at [subdl.com](https://subdl.com/panel/signup), then find the key in
your account panel (their [API docs](https://subdl.com/api-doc) point at the
current location if the menu has moved).

It cannot match on file hash, so it will never beat OpenSubtitles on quality, but
it has its own separate daily allowance:

```bash
SUBDL_API_KEY=your_key_here
```

### More than one person in the house

The daily download limit is per account. If several people each register their
own key, put them all in one setting separated by commas and the allowances add
up:

```bash
OPENSUBTITLES_API_KEY=alicekey,bobkey,carolkey
```

The app moves to the next key when one runs out, and back to the first when the
provider's counter resets. Searching is free and unmetered, so it keeps working
from any key even when every download has been used for the day.

With **Under dev** checked you already have 100 downloads a day from a single
key, which is more than a household is likely to watch — so treat this as a
backstop rather than something to organise on day one.

### Subscene (optional, no account)

A third source, and a different shape from the other two: **there is nothing to
register for, but the app cannot search it.** You find the subtitle on the site
yourself and give the player its ID.

The site's search page is behind a Cloudflare bot check. Getting past that means
pretending not to be a program, which this project does not do — so the half that
is open (fetching a subtitle by ID, which the site allows) is the half that is
built.

**Setting it up: nothing to do.** The address ships in `.env.example` and works
as it stands:

```bash
SUBSCENE_URL=https://sub-scene.com
```

It is a setting rather than something built in for a reason: the original
`subscene.com` shut down in May 2024, and the site answering today is a clone
under different ownership. If it moves again, change this one line — no code
change, no update needed. If the box tells you the address is not answering,
that is what has happened: find a working one and put it here.

**This line is the whole of its configuration.** Subscene is a source of its own
and has nothing to do with `SUBTITLE_PROVIDERS` — the app cannot search it, so it
never competes with OpenSubtitles or subdl and there is no ordering for it to be
part of. Set the address and the ID box works; blank it and the box is switched
off and says so. Nothing else affects it, and it works on its own with no API key
for anything else.

> Renamed from `SUBSCENE_BASE_URL`. The old name still works if you are running
> outside Docker, with a note in the log asking you to rename it.

**Using it.** Find your subtitle on the site in an ordinary browser and take the
number off the end of its URL:

```
https://sub-scene.com/subtitle/3358444
                               ^^^^^^^ this is the ID
```

In the player's subtitle panel, under **Find more online**, paste the ID into the
**Subscene ID** box (see the [subtitle panel](#subtitles) screenshot). From the
fifth character on, the app asks the site whether that ID is real, and tells you
what it found:

| The box is | It means |
|---|---|
| red | Not an ID — a pasted whole URL is the usual slip — or still too short |
| amber | Asking the site |
| **green** | There is a subtitle there. The line underneath names it, and **Get** lights up blue |
| red, with a reason | The site answered and has nothing to download at that ID |
| amber, with a reason | The address itself is not answering — the site has moved again, so find a working one and set `SUBSCENE_URL` |
| greyed out | `SUBSCENE_URL` is empty. Set it and restart |

That last one is worth having: some old IDs still have a page but no file behind
it any more, and without the check they look fine right up until the download
fails. The label above the box shows which site is being asked, so you can see it
matches the one you copied the ID from.

Press **Get**. The app downloads it, unzips it if it arrives as an archive, and
saves it next to your video named like any other download, with `SS` for the
source:

```
SS_Ford-V-Ferrari_1080p_en1.srt
```

It then appears in both the **Top** and **Bottom** subtitle menus, the same as a
subtitle that was already in the folder.

**You do not need to pick a language for this.** The ID names one particular file
on the site, and the site says what language it is — so that is what the app
reads, and what the saved file is named after. If a language is selected and the
subtitle turns out to be something else, the panel says so and the file keeps its
real language.

**One ID is often a whole season.** Subscene packs all of a season's episodes
into one archive, and the app handles that the way you would want:

- the episode you are **watching** is the one that gets selected — matched by
  `S01E05` in the names, not by the order inside the ZIP;
- every other episode in the pack that has a **video file in the same folder**
  gets its subtitle saved too, so one ID subtitles the season and episode 6 is
  ready when you reach it;
- if the archive turns out not to contain the episode playing, nothing is saved
  and it tells you what the archive does hold.

> The download link is read out of the page, so the app only accepts one pointing
> at the site itself or at its known archive host, `res.subscene.best`.

## Docker

If Docker is what you have, `0_setup` picks it automatically and `./1_run` starts
the container — no Node.js needed on your machine, since everything builds
inside the image.

Your media folder is mounted writable, because a downloaded subtitle is saved
next to the video it belongs to. Nothing else is ever written: the app only
creates `.srt` and `.vtt` files, only under names it derives from the video
itself, and it never overwrites a file that already exists. If you would rather
it could not write at all, add `:ro` to the media volume in `docker/compose.yml`
and skip [subtitle downloading](#subtitles) — everything else works unchanged.

To switch an existing install between the two, edit `RUN_MODE` in `.env`, or
override it for a single run with `./1_run --docker` / `./1_run --node`.

## Configuration

All settings live in `.env` (copied from `.env.example`, and git-ignored so
your paths stay private).

| Setting | Default | What it does |
| --- | --- | --- |
| `MEDIA_DIR` | — | **Required.** Folder holding your media. Scanned recursively. Written to only when you download a subtitle, which is saved next to the video. |
| `PORT` | `5000` | Port the app listens on. |
| `RUN_MODE` | set by `0_setup` | `docker` or `node` — how `./1_run` starts the app. |
| `WEB_DEV_PORT` | `5173` | Vite dev-server port. Only used by `run-dev`. |
| `OPENSUBTITLES_API_KEY` | empty | Enables subtitle downloading. Comma-separated for several keys. See [Subtitles](#subtitles). |
| `SUBDL_API_KEY` | empty | Optional second source. Also comma-separated. |
| `SUBTITLE_LANGUAGES` | `en,fr,es,hi,ja,it,ko,de,pt,ar` | Languages the subtitle menus offer, in order. |
| `SUBSCENE_URL` | `https://sub-scene.com` | Where to fetch a Subscene subtitle by ID from, and the only setting that affects it. A setting rather than a constant because the site is a clone that has moved before. Empty turns the ID box off. Was `SUBSCENE_BASE_URL`. See [Subtitles](#subtitles). |
| `SUBTITLE_PROVIDERS` | `opensubtitles,subdl` | Which sources to **search**, and your order of preference. The order only breaks ties between equally good matches — a subtitle matched by file hash always wins. Subscene is not one of these: it has no search, so it is not on this line and is unaffected by it. |

Any value can be overridden for a single run — `PORT=8080 ./1_run`, or for the
port specifically, `./1_run --port 8080`.

Re-run `./0_setup` any time to change your answers.

## Development

```bash
./scripts/run-dev
```

Runs the API and the interface as two processes with live reload: edit a React
component and the browser updates instantly; edit the server and it restarts by
itself. Open the **Network** URL that Vite prints — it is reachable from your TV
too, so you can test on the real device as you work.

Press `Ctrl+C` once to stop both.

Other commands:

```bash
npm run build       # build the frontend into web/dist
npm run typecheck   # type-check without emitting
npm test            # both test suites (needs Node 20.19+ or 22.12+)
npm run serve       # run the server alone, against an existing build
```

GitHub Actions runs the tests, the type check and the build on every push, and
plays files in a headless browser through the main scenarios
(`.github/workflows/ci.yml`). The same browser driver is in
`.claude/skills/run-media-player/` — it builds the app, starts it against
generated clips (or a library of your own, with `RUN_MP_MEDIA`) and takes
screenshots; these were taken with it.

`AGENTS.md` holds the rules the code depends on — the old-TV limits, the path
guard, what the app stores — and is worth reading before a change.

## Project structure

```
homereel/
├── 0_setup               one-time setup
├── 1_run                 start the app
├── x_stop                stop it, either runtime
├── web/                  React + TypeScript interface
│   ├── public/           icons and the web app manifest
│   ├── src/
│   │   ├── components/   Home, FileTree, Header, SearchBox, MediaPlayer, ...
│   │   │   └── player/   the player's controls, subtitle panel and hooks
│   │   ├── services/     API client
│   │   ├── utils/        names, subtitles, what the app remembers
│   │   └── main.tsx      entry point
│   ├── index.html
│   └── vite.config.ts    build + dev proxy config
├── server/               Express API and static file server
│   ├── index.js          the API, range streaming, the request log
│   ├── library.js        file scanning, what each name says, search
│   ├── mediaPath.js      the path-containment guard - see Security
│   └── subtitles/        search, download, and archive handling
├── docker/               Container build
│   ├── Dockerfile
│   └── compose.yml
├── scripts/              implementations that 0_setup and 1_run call
│   ├── run               the Node.js path
│   ├── run-dev           development, with live reload
│   ├── run-docker        the Docker path
│   └── lib.sh            shared helpers
├── docs/images/          the screenshots in this guide
└── .env.example          configuration template
```

In production the Express server serves both the API and the built interface on
a single port. In development Vite serves the interface and proxies `/api` to
Express.

## Troubleshooting

**The TV cannot open the page.**
Check the obvious one first — the TV and the computer must be on the same
network. Guest Wi-Fi and 5 GHz/2.4 GHz split networks often isolate devices
from each other. Then check your firewall, which is the usual culprit:

```bash
sudo ufw allow 5000/tcp          # Linux, if you use ufw
```

On macOS, System Settings → Network → Firewall → Options, and allow incoming
connections for Node.

**A file shows in the list but will not play.**
Your TV's browser cannot decode it, and the player says what would fix it — see
[When a file will not play](#when-a-file-will-not-play) and
[What it does not do](#what-it-does-not-do). Test the same file in your desktop
browser: if it plays there but not on the TV, it is a codec limitation on the TV,
not a bug here.

**A file I just copied in does not show up.**
The library is read again at most once a minute, so a new file can take that long
to appear. Press the rescan button beside **Library** to look straight away.

**The TV still shows the old version after an update.**
Some TV browsers hold on to an old copy of the page. Open the address once with
`?v=2` on the end — `http://192.168.1.21:5000/?v=2` — and it loads afresh.

**`MEDIA_DIR points at a folder that does not exist`.**
Re-run `./0_setup`, or edit `.env` directly. The path must be absolute
(`/home/you/Videos`, not `~/Videos`).

**`Port 5000 is already in use`.**
The message names what is holding the port and suggests a free one. The usual
cause is the Docker copy already running — `./x_stop` first, or use another port.
On macOS, port 5000 is taken by AirPlay Receiver; either turn it off in System
Settings, or pick another port.

```bash
./1_run --port 5050          # just this once
```

Set `PORT` in `.env` to change the default.

**`permission denied` talking to Docker.**
Your user is not in the `docker` group yet. `sudo usermod -aG docker $USER`,
then log out and back in — opening a new terminal is not enough, because group
membership is only picked up at login.

**`container name "/homereel" is already in use`.**
A container left behind by an older version is holding the name. `./1_run` spots
this and offers to remove it for you — answer `y`. It carries no data, so
nothing is lost. To do it by hand: `docker rm -f homereel`, then `./1_run`.

**Nothing appears in the sidebar.**
Only video and audio files are listed; everything else, including subtitle
files, is hidden from the browser (they still work — see [Subtitles](#subtitles)).
Hidden files and folders starting with `.` are skipped too.

**Subtitle search finds results, but downloading always fails.**
Almost certainly the **Allow anonymous downloads** box on your OpenSubtitles
consumer. Searching needs only the API key, so the candidate list looks perfectly
healthy; downloading is the part that returns 401 without it. Edit the consumer
at [opensubtitles.com/en/consumers](https://www.opensubtitles.com/en/consumers),
tick the box, and restart with `./1_run`. You can check the key directly:

```bash
curl -s -H "Api-Key: YOUR_KEY" -H "User-Agent: homereel v1.0.0" \
  -H "Content-Type: application/json" -d '{"file_id":1}' \
  https://api.opensubtitles.com/api/v1/download
```

A reply containing `link` and `remaining` means anonymous downloads are on. A 401
means they are not.

**Subtitle downloads stop working part-way through the day.**
You have used the daily allowance — 100 downloads with **Under dev** checked, 5
without. The count shown under the language menus is what is left. Searching
carries on working regardless, so you can still see what is on offer and add a
file by hand.

## Security

The server only ever serves files from inside `MEDIA_DIR`. Requested paths are
resolved and checked for containment before anything is read, so `..` sequences
and absolute paths cannot escape that folder.

Subtitle downloading is the one feature that writes to `MEDIA_DIR`, and it is
deliberately narrow: the filename is derived from your video rather than from
anything the provider sent, only `.srt` and `.vtt` are ever created, an existing
file is never overwritten, and the downloaded bytes have to prove they contain
subtitle timings before they are saved — so a provider link that quietly redirects
to an ad page ends up rejected instead of next to your films.

There is no login, though. Treat it as visible to everyone on your network, and
do not expose the port to the internet.
