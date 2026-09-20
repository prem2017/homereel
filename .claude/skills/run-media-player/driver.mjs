#!/usr/bin/env node
// Agent driver for the media player: fixture media, a scratch frontend build, the
// real server on loopback, and headless Chromium through playwright-core.
//
//   node .claude/skills/run-media-player/driver.mjs <<'EOF'   commands on stdin
//   node .claude/skills/run-media-player/driver.mjs serve      server only, until killed
//
// Env: RUN_MP_WORK (default $TMPDIR/run-media-player), RUN_MP_PORT (default: any
// free port), RUN_MP_REBUILD=1 (force a frontend build).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.resolve(process.env.RUN_MP_WORK || path.join(os.tmpdir(), 'run-media-player'));
const PLAYWRIGHT = 'playwright-core@1.59.1';
const FIXTURES = 'fixtures-v2';

const say = (msg) => process.stderr.write(`[driver] ${msg}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : String(r.stderr || r.stdout || '').slice(-1500);
    throw new Error(`${cmd} ${args.join(' ')} failed: ${why}`);
  }
  return r.stdout;
};

// Named to exercise real behaviour: natural sort (1, 2, 10), an accented folder
// holding a dotted release name, a windows-1252 subtitle beside a UTF-8 one, a
// file long enough to resume (>30s in and >30s left), audio, a black clip with no
// subtitles (for `dark`), and a non-media file the library must hide.
const ensureMedia = () => {
  const pristine = path.join(WORK, FIXTURES);
  if (!fs.existsSync(path.join(pristine, '.done'))) {
    say('generating fixture media with ffmpeg (one-time)');
    fs.rmSync(pristine, { recursive: true, force: true });
    const at = (rel) => {
      const file = path.join(pristine, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return file;
    };
    const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050'];
    const video = (rel, seconds) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', ...tone, '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k',
      '-shortest', at(rel)]);
    video('Show/Episode 1.mp4', 40);
    for (const rel of ['Show/Episode 2.mp4', 'Show/Episode 10.mp4',
      'Le Bureau des Légendes/Le.Bureau.des.Legendes.S01E01.1080p.mp4']) {
      fs.copyFileSync(path.join(pristine, 'Show/Episode 1.mp4'), at(rel));
    }
    video('Long/Documentary.mp4', 120);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10',
      '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', at('Dark/Night.mp4')]);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...tone, '-t', '20', at('Music/Chanson.flac')]);
    const srt = (text) => `1\n00:00:00,500 --> 00:00:39,000\n${text}\n`;
    fs.writeFileSync(at('Show/Episode 1.en.srt'), srt('Hello from the English file'));
    fs.writeFileSync(at('Show/Episode 1.srt'), Buffer.from(srt('Café crème, déjà vu'), 'latin1'));
    fs.writeFileSync(at('notes.txt'), 'Not media. The library must not list this.\n');
    fs.writeFileSync(path.join(pristine, '.done'), '');
  }
  // A fresh copy every run: rescans, `sh` and fake downloads change the folder.
  const media = path.join(WORK, 'media');
  fs.rmSync(media, { recursive: true, force: true });
  fs.cpSync(pristine, media, { recursive: true, filter: (src) => path.basename(src) !== '.done' });
  return media;
};

const newest = (p) => {
  const st = fs.statSync(p);
  return st.isDirectory()
    ? fs.readdirSync(p).reduce((max, name) => Math.max(max, newest(path.join(p, name))), st.mtimeMs)
    : st.mtimeMs;
};

// Into the work dir, never web/dist: that is what a real ./1_run instance serves.
const ensureBuild = () => {
  const vite = path.join(REPO, 'node_modules', '.bin', 'vite');
  if (!fs.existsSync(vite)) throw new Error('node_modules is missing: run `npm install` at the repo root');
  const web = path.join(REPO, 'web');
  const dist = path.join(WORK, 'dist');
  const index = path.join(dist, 'index.html');
  const inputs = ['src', 'index.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'package.json']
    .map((rel) => path.join(web, rel)).filter((p) => fs.existsSync(p));
  const built = fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0;
  if (process.env.RUN_MP_REBUILD || inputs.some((p) => newest(p) > built)) {
    say('building web/ into the work dir');
    run(vite, ['build', '--outDir', dist, '--emptyOutDir'], { cwd: web });
  }
  return dist;
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const startServer = async (media, dist) => {
  const port = Number(process.env.RUN_MP_PORT) || await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logFile = path.join(WORK, 'server.log');
  const out = fs.openSync(logFile, 'w');
  const entry = JSON.stringify(path.join(REPO, 'server', 'index.js'));
  // index.js exports the app and listens on 0.0.0.0 only when run directly;
  // requiring it keeps this server on loopback.
  const child = spawn(process.execPath, ['-e', `require(${entry}).listen(${port}, '127.0.0.1')`], {
    stdio: ['ignore', out, out],
    // No provider keys from the calling shell, and a Subscene address the server
    // refuses to fetch: nothing leaves the machine.
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
      MEDIA_DIR: media, WEB_DIST: dist, SUBSCENE_URL: 'http://127.0.0.1:9',
    },
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}; see ${logFile}`);
    try { if ((await fetch(`${base}/api/files`)).ok) break; } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`no answer from ${base}; see ${logFile}`);
    await sleep(200);
  }
  return { base, child, logFile };
};

const launchBrowser = async () => {
  const prefix = path.join(WORK, 'playwright');
  const entry = path.join(prefix, 'node_modules', 'playwright-core');
  if (!fs.existsSync(entry)) {
    say(`installing ${PLAYWRIGHT} into ${prefix} (one-time, not a project dependency)`);
    run('npm', ['install', '--prefix', prefix, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', PLAYWRIGHT]);
  }
  const { chromium } = createRequire(import.meta.url)(entry);
  // Playwright's own headless Chromium plays H.264/AAC; system Chrome is not needed.
  const options = { headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] };
  try {
    return await chromium.launch(options);
  } catch (e) {
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    say('downloading headless Chromium for playwright-core (one-time)');
    run(process.execPath, [path.join(entry, 'cli.js'), 'install', '--only-shell', 'chromium']);
    return chromium.launch(options);
  }
};

// Installed into the page: `state` prints it, and `expect` expressions can call it.
const pageHelpers = () => {
  const text = (el) => (el ? el.textContent.trim() : null);
  const byText = (selector, value) => Array.from(document.querySelectorAll(selector))
    .find((el) => el.textContent.trim() === value);
  window.__mp = {
    state() {
      const media = document.querySelector('video, audio');
      const showing = media ? Array.from(media.textTracks).filter((t) => t.mode === 'showing') : [];
      const cues = showing.flatMap((t) => Array.from(t.activeCues || []).map((c) => c.text));
      const recent = byText('h2', 'Continue watching');
      const panel = byText('h3', 'Subtitles');
      const menu = (label) => {
        const l = panel && Array.from(panel.parentElement.querySelectorAll('label'))
          .find((x) => x.textContent.trim().startsWith(label));
        const select = l && l.nextElementSibling;
        return select && select.tagName === 'SELECT'
          ? { value: select.value, options: Array.from(select.options).map((o) => o.value).filter(Boolean) }
          : null;
      };
      return {
        title: document.title,
        playing: media && media.currentSrc ? decodeURIComponent(media.currentSrc.split('path=')[1] || '') : null,
        time: media ? Math.round(media.currentTime * 10) / 10 : null,
        paused: media ? media.paused : null,
        // Native cues live in the browser's shadow DOM; the top one is ours.
        bottomCue: cues.length ? cues.join(' / ') : null,
        topCue: text(document.querySelector('div.absolute.z-20.text-center.pointer-events-none > span')),
        fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
        alert: text(document.querySelector('[role="alert"]')),
        continueWatching: recent ? Array.from(recent.parentElement.querySelectorAll('button')).map((b) => b.title) : [],
        panel: panel ? {
          top: menu('Top Source'),
          bottom: menu('Bottom Source'),
          notice: text(panel.parentElement.querySelector('.text-amber-300')),
          error: text(panel.parentElement.querySelector('.text-red-400')),
          text: panel.parentElement.textContent.slice(0, 500),
        } : null,
      };
    },
  };
};

let page;
let server;
let media;
let failures = 0;
let shots = 0;
let held = null;
const consoleErrors = [];

const rowFor = (rel) => page.locator(`[id="file-node-${rel.replace(/[^a-zA-Z0-9]/g, '_')}"]`);
const requireRow = async (rel) => {
  const row = rowFor(rel);
  try {
    await row.waitFor({ timeout: 3000 });
  } catch {
    throw new Error(`no "${rel}" row in the library (run: rows)`);
  }
  return row;
};
const splitArg = (arg) => {
  const at = arg.indexOf(' = ');
  if (at < 0) throw new Error('expected "<target> = <value>"');
  return [arg.slice(0, at).trim(), arg.slice(at + 3)];
};
const waitPlaying = (rel) => page.waitForFunction((wanted) => {
  const m = document.querySelector('video, audio');
  return m && decodeURIComponent(m.currentSrc).includes(wanted) && m.currentTime > 0.2;
}, rel, { timeout: 15000 });

// Hidden controls are pointer-events-none, so clicking one without this times out.
const revealControls = async () => {
  const target = (await page.$('video')) || (await page.$('div.group.bg-black'));
  const box = target && (await target.boundingBox());
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5);
  await sleep(150);
};

const openPanel = async () => {
  if (await page.locator('h3:text-is("Subtitles")').count()) return;
  await revealControls();
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await page.locator('label:has-text("Bottom Source")').waitFor();
};

const screenshot = async (name = 'shot') => {
  shots += 1;
  const file = path.join(WORK, 'shots', `${String(shots).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '-')}.png`);
  await page.screenshot({ path: file });
  return file;
};

const commands = {
  async open(arg) {
    await page.goto(`${server.base}${arg || '/'}`);
    await page.waitForFunction(() => document.querySelector('[role="treeitem"], [role="alert"]')
      || /Could not load media|No video or audio files/.test(document.body.innerText), null, { timeout: 20000 });
    return page.url();
  },
  async rows() {
    const rows = await page.$$eval('[role="treeitem"]', (els) => els.map((el) => {
      const open = el.getAttribute('aria-expanded');
      const mark = open === null ? ' ' : open === 'true' ? 'v' : '>';
      const pad = '  '.repeat((Number(el.getAttribute('aria-level')) || 1) - 1);
      const selected = el.getAttribute('aria-selected') === 'true' ? '  (selected)' : '';
      return `${pad}${mark} ${el.querySelector('span.truncate').textContent}${selected}`;
    }));
    return rows.join('\n');
  },
  async play(rel) {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const folder = await requireRow(parts.slice(0, i).join('/'));
      // Selecting a file opens its folder, so a blind click can close it again.
      if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
    }
    await (await requireRow(rel)).click();
    await waitPlaying(rel);
    return `playing ${rel}`;
  },
  async search(query) {
    const input = page.getByPlaceholder('Search media...');
    if (!query) {
      await input.fill('');
      return 'search cleared';
    }
    const answered = page.waitForResponse((r) => r.url().includes('/api/search')
      && new URL(r.url()).searchParams.get('q') === query);
    await input.fill(query);
    await answered;
    await sleep(200);
    const hits = await page.$$eval('button', (buttons) => buttons
      .map((b) => [b.querySelector(':scope > div.flex-col > span.text-xs'), b.querySelector(':scope > svg')])
      .filter(([where]) => where)
      // lucide-react adds no per-icon class; Header colours Music purple, Film blue.
      .map(([where, icon]) => `${icon && icon.getAttribute('class').includes('purple') ? 'audio' : 'video'}  ${where.textContent}`));
    return hits.length ? hits.join('\n') : 'no results';
  },
  async pick(rel) {
    const hit = page.locator('button').filter({ has: page.locator(`span.text-xs:text-is(${JSON.stringify(rel)})`) }).first();
    try {
      await hit.waitFor({ timeout: 3000 });
    } catch {
      throw new Error(`"${rel}" is not in the current search results (run: search <words>)`);
    }
    await hit.click();
    await waitPlaying(rel);
    return `playing ${rel}`;
  },
  async button(name) {
    await revealControls();
    await page.getByRole('button', { name, exact: true }).first().click();
    return `clicked ${name}`;
  },
  async click(selector) {
    await page.locator(selector).first().click();
    return `clicked ${selector}`;
  },
  async fill(arg) {
    const [selector, value] = splitArg(arg);
    await page.locator(selector).first().fill(value);
    return `filled ${selector}`;
  },
  async select(arg) {
    const [label, value] = splitArg(arg);
    await openPanel();
    await page.locator(`label:has-text(${JSON.stringify(label)}) + select`).selectOption(value);
    return `${label} = ${value}`;
  },
  async key(name) {
    await page.keyboard.press(name);
    return `pressed ${name}`;
  },
  async controls() {
    await revealControls();
    return 'controls shown';
  },
  async subs() {
    await openPanel();
    return 'subtitle panel open';
  },
  async wait(ms) {
    await sleep(Number(ms) || 1000);
  },
  async 'wait-for'(selector) {
    await page.locator(selector).first().waitFor({ timeout: 15000 });
    return `visible ${selector}`;
  },
  async state() {
    return JSON.stringify(await page.evaluate(() => window.__mp.state()), null, 2);
  },
  async expect(expression) {
    try {
      await page.waitForFunction(`(() => { try { return !!(${expression}); } catch (e) { return false; } })()`,
        null, { timeout: 5000, polling: 100 });
      return `PASS  ${expression}`;
    } catch {
      failures += 1;
      const state = await page.evaluate(() => window.__mp.state()).catch(() => null);
      return `FAIL  ${expression}\n      state: ${JSON.stringify(state)}`;
    }
  },
  async eval(expression) {
    const value = await page.evaluate(expression);
    return value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
  },
  async screenshot(name) {
    return screenshot(name || undefined);
  },
  // A native cue is painted outside the DOM, so the picture is the only witness:
  // over Dark/Night.mp4, once the controls have faded, a bright pixel is a subtitle.
  async dark(selector) {
    await page.mouse.move(0, 0);
    try {
      await page.waitForFunction(() => ['Subtitles', 'Fullscreen', 'Exit fullscreen']
        .map((name) => document.querySelector(`button[aria-label="${name}"]`))
        .filter(Boolean)
        .every((button) => {
          let opacity = 1;
          for (let el = button; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity);
          return opacity === 0;
        }), null, { timeout: 8000 });
    } catch {
      throw new Error('the controls did not fade - `dark` needs a playing video');
    }
    const file = path.join(WORK, 'shots', 'dark.png');
    await page.locator(selector).first().screenshot({ path: file });
    const gray = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer' });
    const bright = gray.reduce((count, value) => count + (value > 128 ? 1 : 0), 0);
    if (bright >= 20) failures += 1;
    return `${bright < 20 ? 'PASS' : 'FAIL'}  ${selector} is dark: ${bright} bright pixels`;
  },
  async viewport(arg) {
    const [width, height] = arg.split(/\s+/).map(Number);
    await page.setViewportSize({ width, height });
    return `viewport ${width}x${height}`;
  },
  async log(count) {
    return fs.readFileSync(server.logFile, 'utf8').trimEnd().split('\n').slice(-(Number(count) || 20)).join('\n');
  },
  async api(rel) {
    const r = await fetch(`${server.base}${rel}`);
    const body = await r.text();
    return `HTTP ${r.status}\n${body.length > 3000 ? `${body.slice(0, 3000)}…` : body}`;
  },
  async sh(cmd) {
    const r = spawnSync('sh', ['-c', cmd], { cwd: media, encoding: 'utf8' });
    if (r.status !== 0) failures += 1;
    return `${r.stdout}${r.stderr}`.trimEnd() + (r.status ? `\n(exit ${r.status})` : '');
  },
  async console() {
    return consoleErrors.splice(0).join('\n') || 'no console errors';
  },
  // Providers need keys and the network. This answers their three endpoints in
  // the browser instead, and writes a real .srt so the menus can load it. Call it
  // before `open`: the player asks for languages once, when it mounts.
  async 'fake-subtitles'() {
    await page.route('**/api/subtitles/languages', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), providers: ['opensubtitles'], unavailable: [] } });
    });
    await page.route('**/api/subtitles/search**', (route) => {
      const url = new URL(route.request().url());
      const video = url.searchParams.get('path');
      const language = url.searchParams.get('language') || 'en';
      const title = path.posix.basename(video, path.posix.extname(video));
      return route.fulfill({ json: { unavailable: [], candidates: [{
        provider: 'opensubtitles', ref: `fake:${video}`, language, release: `FAKE ${title}`,
        fileName: `FAKE ${title}.srt`, downloads: 1, hashMatch: false, tier: 2,
      }] } });
    });
    await page.route('**/api/subtitles/download', async (route) => {
      const { path: video, language = 'en' } = JSON.parse(route.request().postData() || '{}');
      if (held) {
        say(`holding the download for ${video} until release-downloads`);
        await held.promise;
      }
      const folder = path.posix.dirname(video);
      const slug = path.posix.basename(video, path.posix.extname(video)).replace(/[^A-Za-z0-9]+/g, '-');
      const count = fs.readdirSync(path.join(media, folder)).filter((n) => n.startsWith(`OS_${slug}_${language}`)).length;
      const name = `OS_${slug}_${language}${count + 1}.srt`;
      const rel = folder === '.' ? name : `${folder}/${name}`;
      fs.writeFileSync(path.join(media, rel),
        `1\n00:00:00,500 --> 00:10:00,000\nFake ${language} subtitle for ${path.posix.basename(video)}\n`);
      await route.fulfill({ json: { path: rel, name, language, alsoSaved: [], quota: { remaining: 99, resetTime: null } } });
    });
    return 'fake provider answers /api/subtitles/{languages,search,download}';
  },
  async 'hold-downloads'() {
    let release;
    held = { promise: new Promise((resolve) => { release = resolve; }), release };
    return 'downloads now wait for release-downloads';
  },
  async 'release-downloads'() {
    if (held) held.release();
    held = null;
    return 'downloads released';
  },
  async help() {
    return Object.keys(commands).join(' ');
  },
};

const main = async () => {
  fs.mkdirSync(WORK, { recursive: true });
  media = ensureMedia();
  const dist = ensureBuild();
  server = await startServer(media, dist);
  say(`server ${server.base}  media ${media}  log ${server.logFile}`);

  if (process.argv[2] === 'serve') {
    console.log(`BASE=${server.base}`);
    return new Promise(() => {}); // until SIGINT/SIGTERM
  }

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(pageHelpers);
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().split('\n')[0]); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  fs.rmSync(path.join(WORK, 'shots'), { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });

  for await (const raw of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    console.log(`> ${line}`);
    const name = line.split(/\s+/, 1)[0];
    if (name === 'quit') break;
    if (!Object.prototype.hasOwnProperty.call(commands, name)) {
      failures += 1;
      console.log(`unknown command "${name}" - try: help`);
      continue;
    }
    try {
      const output = await commands[name](line.slice(name.length).trim());
      if (output) console.log(output);
    } catch (e) {
      failures += 1;
      console.log(`ERROR ${e.message.split('\n')[0]}`);
      console.log(`      screenshot: ${await screenshot('error').catch(() => 'unavailable')}`);
    }
  }
  await browser.close();
  console.log(failures ? `${failures} command(s) failed` : 'all commands ok');
  return failures ? 1 : 0;
};

process.on('exit', () => { if (server && server.child.exitCode === null) server.child.kill(); });
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

main().then((code) => process.exit(code), (e) => {
  say(e.message);
  process.exit(2);
});
