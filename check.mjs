// node check.mjs — the context-aware suggestions pick the right next step.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggest } from './suggest.mjs';

const labels = (dir) => suggest(dir).map((s) => s.label);
const fresh = () => mkdtempSync(join(tmpdir(), 'dt-'));

// Empty folder: first move is getting a project.
assert.ok(labels(fresh()).includes('Get a project from GitHub'));

// Node project, not installed: install first, no "Start" yet.
const app = fresh();
writeFileSync(join(app, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }));
assert.ok(labels(app).includes('Install what it needs'));
assert.ok(!labels(app).includes('Start the app'));
assert.ok(!labels(app).includes('Get a project from GitHub'));

// Installed: now "Start", with the right package manager.
mkdirSync(join(app, 'node_modules'));
writeFileSync(join(app, 'pnpm-lock.yaml'), '');
assert.ok(!labels(app).includes('Install what it needs'));
assert.equal(suggest(app).find((s) => s.label === 'Start the app').cmd, 'pnpm run dev');

// Git repo: see changes, get latest, ask Claude. Looking runs instantly, changing waits.
mkdirSync(join(app, '.git'));
const byLabel = Object.fromEntries(suggest(app).map((s) => [s.label, s]));
assert.equal(byLabel['See what changed'].run, true);
assert.equal(byLabel['Get latest'].run, false);
assert.ok(byLabel['Ask Claude']);

// Root has nowhere to go up to.
assert.ok(!labels('/').includes('Go up a folder'));

// --- Split panes (panes.js is a browser script; run it with a window stub) ---
const ctx = { window: {} };
runInNewContext(readFileSync(new URL('./panes.js', import.meta.url), 'utf8'), ctx);
const { split, remove, leaves, neighbor } = ctx.window.Panes;

let root = { id: 1 };
root = split(root, 1, 2, 'row');      // [1 | 2]
root = split(root, 2, 3, 'col');      // [1 | 2 / 3]
assert.deepEqual([...leaves(root)], [1, 2, 3]);
root = remove(root, 2);               // sibling 3 takes 2's place
assert.deepEqual([...leaves(root)], [1, 3]);
assert.equal(root.dir, 'row');
assert.equal(remove(remove(root, 1), 3), null); // last pane gone -> empty tab

// A dragged split keeps its size through later splits and closes.
const sized = { dir: 'row', ratio: 0.3, a: { id: 1 }, b: { id: 2 } };
assert.equal(split(sized, 2, 3, 'col').ratio, 0.3);
assert.equal(remove(split(sized, 2, 3, 'col'), 3).ratio, 0.3);

const rects = { 1: { x: 0, y: 0, w: 50, h: 100 }, 2: { x: 50, y: 0, w: 50, h: 50 }, 3: { x: 50, y: 50, w: 50, h: 50 } };
assert.equal(neighbor(rects, 1, 'ArrowRight'), '2'); // nearest center to the right
assert.equal(neighbor(rects, 1, 'ArrowLeft'), null);
assert.equal(neighbor(rects, 2, 'ArrowDown'), '3');
assert.equal(neighbor(rects, 3, 'ArrowLeft'), '1');

// --- Themes (generated data: catch a bad conversion) ---
runInNewContext(readFileSync(new URL('./themes.js', import.meta.url), 'utf8'), ctx);
const { THEMES } = ctx.window;
const COLORS = ['background', 'foreground', 'cursor', 'accent', 'onAccent', ...['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  .flatMap((k) => [k, 'bright' + k[0].toUpperCase() + k.slice(1)])];
assert.ok(THEMES.length >= 20);
assert.equal(THEMES[0].name, 'Designer'); // the default
assert.equal(new Set(THEMES.map((t) => t.name)).size, THEMES.length);
assert.ok(THEMES.filter((t) => !t.dark).length >= 6);
for (const t of THEMES) {
  for (const k of COLORS) assert.match(t[k], /^#[0-9a-f]{6}$/, `${t.name}.${k}`);
  assert.match(t.selectionBackground, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, t.name);
}

// --- Preview helpers (preview.js, browser script) ---
runInNewContext(readFileSync(new URL('./preview.js', import.meta.url), 'utf8'), ctx);
const { findLocalUrl, stripAnsi, dropText } = ctx.window.Preview;
assert.equal(findLocalUrl('  ▲ Next.js 15\n  - Local:        http://localhost:3000\n'), 'http://localhost:3000/');
// Vite bolds the port; a URL split across two output chunks is caught once they're joined.
const vite = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m';
assert.equal(findLocalUrl(stripAnsi(vite.slice(0, 50))), null);
assert.equal(findLocalUrl(stripAnsi(vite)), 'http://localhost:5173/');
assert.equal(findLocalUrl('listening on http://0.0.0.0:8080/app.'), 'http://localhost:8080/app');
assert.equal(findLocalUrl('see https://github.com/foo and localhost:3000'), null); // not local / no scheme
assert.equal(findLocalUrl('http://localhost:3000 then http://127.0.0.1:4000'), 'http://127.0.0.1:4000/'); // the latest
assert.equal(dropText(['/Users/me/My Designs/hero (final).png']), '/Users/me/My\\ Designs/hero\\ \\(final\\).png ');
assert.equal(dropText(['/a/it\'s & more', '/b/café.svg']), "/a/it\\'s\\ \\&\\ more /b/café.svg ");

// --- What terminal apps ask of us (protocols.js, browser script) ---
const pctx = { window: {}, atob, TextDecoder };
runInNewContext(readFileSync(new URL('./protocols.js', import.meta.url), 'utf8'), pctx);
const P = pctx.window.Protocols;
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context aren't deepEqual to ours
const b64 = (s) => Buffer.from(s).toString('base64');
// Notifications: iTerm's OSC 9 (but not ConEmu's 9;4 progress), OSC 777, kitty's OSC 99.
assert.deepEqual(plain(P.notifyFrom(9, 'Build finished')), { title: '', body: 'Build finished' });
assert.equal(P.notifyFrom(9, '4;1;50'), null);
assert.deepEqual(plain(P.notifyFrom(777, 'notify;OpenCode;Done; all good')), { title: 'OpenCode', body: 'Done; all good' });
assert.equal(P.notifyFrom(777, 'preexec'), null);
const k = P.kitty99();
assert.deepEqual(plain(k('i=opentui-notifications:p=?;')), { query: 'opentui-notifications' });
assert.equal(k(`i=1:d=0:e=1;${b64('Session ')}`), null); // more coming
assert.equal(k(`i=1:d=0:e=1;${b64('done')}`), null);
assert.deepEqual(plain(k(`i=1:p=body:e=1;${b64('It took 2 minutes ✓')}`)), { title: 'Session done', body: 'It took 2 minutes ✓' });
assert.deepEqual(plain(k(';Hello')), { title: 'Hello', body: '' });
// OpenTUI turns notifications on when the reply names p=? and offers titles.
const reply = P.kitty99Reply('opentui-notifications');
assert.ok(reply.startsWith('\x1b]99;i=opentui-notifications:p=?;') && reply.includes('p=title') && reply.endsWith('\x1b\\'));
// Clipboard: writes only, never reads; big ones are dropped.
assert.equal(P.clipFrom(`c;${b64('héllo ✳')}`), 'héllo ✳');
assert.equal(P.clipFrom(`;${b64('x')}`), 'x');
assert.equal(P.clipFrom('c;?'), null);
assert.equal(P.clipFrom('c;'), null);
assert.equal(P.clipFrom(`c;${'A'.repeat(2_000_000)}`), null);
// Which AI tool is open, and is it working?
assert.equal(P.AGENTS.opencode.name, 'OpenCode');
assert.equal(P.AGENTS.ls, undefined);
assert.equal(P.agentFromTitle('✳ Claude Code'), 'claude');
assert.equal(P.agentFromTitle('OpenCode'), 'opencode');
assert.equal(P.agentFromTitle('OC | Fix the hero'), 'opencode');
assert.equal(P.agentFromTitle('vim notes.md'), null);
assert.equal(P.claudeTitle('◐ Fixing the hero'), true);
assert.equal(P.claudeTitle('✳ Fixing the hero'), false);
assert.equal(P.claudeTitle('Claude Code'), null);
assert.ok(P.interruptHint('■■■⬝⬝⬝  esc interrupt        tab agents  ctrl+p commands')); // OpenCode
assert.ok(P.interruptHint('• Working (12s • esc to interrupt)')); // Codex
assert.ok(P.interruptHint('⠏ Thinking… (esc to cancel, 4s)')); // Gemini
assert.ok(!P.interruptHint('~/site  24.4K (12%)  ctrl+p commands'));

// --- Icons (icons.js, browser script) ---
const ic = {}; ic.window = ic; // icon() reads ICONS as a global, like in the page
runInNewContext(readFileSync(new URL('./icons.js', import.meta.url), 'utf8'), ic);
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const used = [
  ...[...src('./index.html').matchAll(/data-icon="([\w-]+)"/g)].map((m) => m[1]),
  ...[...src('./renderer.js').matchAll(/icon\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([\w-]+)"/g)].map((q) => q[1])),
];
assert.ok(used.length > 20);
for (const name of used) assert.ok(ic.ICONS[name], `icon "${name}" is used but not in icons.js`);
for (const [name, svg] of Object.entries(ic.ICONS)) assert.match(svg, /^<(path|rect|circle)[^]*\/>$/, name);
assert.match(ic.icon('x'), /^<svg class="ic" viewBox="0 0 24 24"[^>]*><path d="M18 6 6 18"\/>/);
const kinds = { 'hero.PNG': 'file-image', 'intro.mp4': 'file-video', 'Home.fig': 'pen-tool', 'Button.tsx': 'file-code',
  'app.css': 'file-code', 'index.html': 'file-code', 'package.json': 'file-braces', 'pnpm-lock.lock': 'file-cog',
  'README.md': 'file-text', 'Dune.EPUB': 'book-open', 'Inter.woff2': 'file-type', 'Makefile': 'file', 'archive.tar.gz': 'file-archive' };
for (const [name, icon] of Object.entries(kinds)) {
  assert.deepEqual({ ...ic.fileIcon(name) }, { icon }, name);
  assert.ok(ic.ICONS[icon], icon);
}

// --- Files: tree listing and what the preview shows (files.mjs) ---
const { list, readPreview, readBook } = await import('./files.mjs');
const proj = fresh();
mkdirSync(join(proj, 'node_modules'));
mkdirSync(join(proj, 'src'));
writeFileSync(join(proj, '.env'), 'SECRET=1');
writeFileSync(join(proj, 'README.md'), '# Hello\n\nSee ![shot](shot.png) and [docs](docs.md).\n');
writeFileSync(join(proj, 'app.ts'), 'const x: number = 1;\n');
writeFileSync(join(proj, 'notes'), 'plain <b>text</b>\n');
writeFileSync(join(proj, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
writeFileSync(join(proj, 'data.bin'), Buffer.from([1, 2, 0, 3]));
writeFileSync(join(proj, 'huge.json'), 'x'.repeat(1024 * 1024 + 1));
assert.deepEqual(list(proj).map((e) => e.name).slice(0, 2), ['src', 'node_modules']); // noise folders last
assert.ok(list(proj).find((e) => e.name === 'node_modules').noise);
assert.ok(!list(proj).some((e) => e.name === '.env')); // hidden files stay hidden
assert.deepEqual(list(join(proj, 'nope')), []);
assert.equal((await readPreview(join(proj, 'shot.png'))).kind, 'image');
const md = await readPreview(join(proj, 'README.md'));
assert.equal(md.kind, 'markdown');
assert.match(md.html, /<h1>Hello<\/h1>/);
const ts = await readPreview(join(proj, 'app.ts'));
assert.equal(ts.kind, 'code');
assert.match(ts.html, /^<span class="line"><span style="color:var\(--code-token-keyword\)">const<\/span>/);
assert.equal(ts.lines, 1);
// The line that made highlight.js colour the rest of a file as one long string.
const tricky = join(proj, 'esc.js');
writeFileSync(tricky, `const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '<': '&lt;', '"': '&quot;' }[c]));\nconst next = 1;\n`);
assert.match((await readPreview(tricky)).html.split('\n')[1], /--code-token-keyword\)">const</);
assert.equal((await readPreview(join(proj, 'notes'))).html, 'plain &lt;b&gt;text&lt;/b&gt;\n'); // unknown type: escaped, not rendered
assert.equal((await readPreview(join(proj, 'data.bin'))).kind, 'other');
assert.equal((await readPreview(join(proj, 'huge.json'))).why, 'big');
assert.equal((await readPreview(join(proj, 'gone.txt'))).kind, 'missing');
// Books for the Read view: only PDFs and EPUBs, as bytes.
writeFileSync(join(proj, 'Book.PDF'), '%PDF-1.4');
assert.equal(Buffer.from(readBook(join(proj, 'Book.PDF')).bytes).toString(), '%PDF-1.4');
assert.equal(readBook(join(proj, 'app.ts')).error, 'kind'); // never any other file
assert.equal(readBook(join(proj, 'gone.epub')).error, 'missing');
assert.equal(readBook(undefined).error, 'kind');

// --- Shell integration (shell/.zshrc): a command's first word, even when it's the only word ---
{
  const { execFileSync } = await import('node:child_process');
  const hook = src('./shell/.zshrc').match(/^__dt_preexec\(\) \{[^]*?^\}/m)[0];
  const first = (cmd) => execFileSync('zsh', ['-f', '-c', `${hook}\n__dt_preexec "$1"`, 'zsh', cmd], { encoding: 'utf8' });
  assert.equal(first('claude'), '\x1b]133;C;claude\x07'); // was "c": Fork never knew Claude was open
  assert.equal(first('npm run dev'), '\x1b]133;C;npm\x07');
  assert.equal(first('FOO=1 git status'), '\x1b]133;C;FOO1\x07'); // only safe characters leave the shell
}

// --- Read view helpers (reader.js, browser script) ---
const rd = { window: {} };
runInNewContext(readFileSync(new URL('./reader.js', import.meta.url), 'utf8'), rd);
const { kindOf: bookKind, remember, percent, MAX_RECENT } = rd.window.Reader.logic;
assert.equal(bookKind('/b/Dune.epub'), 'epub');
assert.equal(bookKind('/b/Paper.PDF'), 'pdf');
assert.equal(bookKind('/b/notes.md'), null);
assert.equal(bookKind('/b.pdf/README'), null); // a folder named like a book isn't one
assert.equal(bookKind(undefined), null);
let shelf = [];
for (let i = 0; i < MAX_RECENT + 5; i++) shelf = remember(shelf, { path: `/b/${i}.pdf` });
assert.equal(shelf.length, MAX_RECENT); // the oldest drop off
assert.equal(shelf[0].path, `/b/${MAX_RECENT + 4}.pdf`); // newest first
shelf = remember(shelf, { path: '/b/10.pdf', where: 7 });
assert.equal(shelf[0].where, 7);
assert.equal(shelf.filter((b) => b.path === '/b/10.pdf').length, 1); // reopening moves it up, no duplicate
assert.equal(remember('broken', { path: '/x.pdf' }).map((b) => b.path).join(), '/x.pdf'); // damaged storage
assert.deepEqual([percent(0.123), percent(undefined), percent(2)], ['12%', '0%', '100%']);

// --- The Bloub mascot bundle (vendor/bloub/bloub.js): loads standalone and draws the thinking pose ---
const bctx = { performance, setTimeout, clearTimeout };
runInNewContext(readFileSync(new URL('./vendor/bloub/bloub.js', import.meta.url), 'utf8'), bctx);
const bloub = new bctx.Bloub.BloubController({ state: 'thinking', color: '#7c6cff' });
const pose = bloub.sample(1);
assert.ok(pose.bodyPath.length > 20 && !/NaN|Infinity/.test(pose.bodyPath));
assert.ok(pose.dots.length >= 2 && pose.dots.every((d) => Number.isFinite(d.x + d.r)));
bloub.dispose();
assert.equal(typeof bctx.Bloub.createPixelView, 'function'); // blob.js draws them as pixel art

// --- Games (games.js, browser script): the rules of Snake, Stack and Space Run ---
const gm = { window: {} };
runInNewContext(readFileSync(new URL('./games.js', import.meta.url), 'utf8'), gm);
const { snake, stack, space, screen, seeded, W: GW, H: GH } = gm.window.Games.logic;
{
  const r = seeded(1), s = snake.init(r);
  s.food = { x: 8, y: 5 }; // right in front of the head
  snake.step(s, new Set(), r);
  assert.equal(s.body.length, 5); assert.equal(s.score, 1); // ate and grew
  assert.ok(!s.body.some((p) => p.x === s.food.x && p.y === s.food.y)); // new food lands somewhere free
  snake.press(s, 'left'); assert.equal(s.queue.length, 0); // can't turn back on yourself
  snake.press(s, 'up'); snake.press(s, 'left'); assert.deepEqual([...s.queue], ['up', 'left']); // quick turns queue up
  const w = snake.init(r); w.food = null;
  for (let i = 0; i < 20 && !w.over; i++) snake.step(w, new Set(), r);
  assert.ok(w.over); // ran into the wall
  const c = snake.init(r); c.food = null;
  c.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }]; c.dir = 'down';
  snake.step(c, new Set(), r); assert.ok(c.over); // bit itself
}
{
  const r = seeded(2), s = stack.init(r);
  for (let i = 0; i < 40; i++) { stack.press(s, 'up', r); stack.press(s, 'left', r); }
  assert.ok(s.piece.cells.every(([x]) => s.piece.x + x >= 0)); // turning at the wall stays inside the well
  s.board[19] = Array(10).fill(1); s.board[19][0] = 0;
  s.piece = { k: 'I', cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x: 0, y: 0 };
  stack.press(s, 'fire', r); // hard drop into the gap
  assert.equal(s.lines, 1); assert.ok(s.score >= 40); assert.equal(s.board[19].filter(Boolean).length, 1); // the full row cleared; the rest of the I dropped into it
  const f = stack.init(r);
  for (let i = 0; i < 200 && !f.over; i++) stack.press(f, 'fire', r);
  assert.ok(f.over); // piling up to the top ends the game
}
{
  const r = seeded(3), s = space.init(r);
  s.foes = [{ x: 20, y: s.ship.y, base: s.ship.y, type: 0, ph: 0, speed: 0 }];
  for (let i = 0; i < 12; i++) space.step(s, new Set(['fire']), r);
  assert.ok(s.score >= 5); // shot it down
  const h = space.init(r);
  h.foes = [{ x: h.ship.x + 2, y: h.ship.y, base: h.ship.y, type: 0, ph: 0, speed: 0 }];
  space.step(h, new Set(), r); assert.equal(h.lives, 2); // flew into it
  for (let i = 0; i < 400 && !h.over; i++) { h.shots.push({ x: h.ship.x + 3, y: h.ship.y + 2 }); space.step(h, new Set(), r); }
  assert.ok(h.over); // out of lives
  for (const g of [snake, stack, space]) { const sc = screen(); g.draw(sc, g.init(seeded(4))); assert.ok(sc.b.some(Boolean) && sc.b.length === GW * GH); }
  // A bigger pane, a bigger world: same small pixels, more room.
  const big = snake.init(seeded(5), 300, 200);
  assert.equal(big.p, 6); assert.equal(big.cols, 49); assert.equal(big.rows, 32); assert.ok(big.body.every((p) => p.y === 16)); // bigger cells, about 30+ across
  const sky = space.init(seeded(6), 300, 200);
  assert.equal(sky.w, 300); assert.equal(sky.ship.y, 100);
  space.wave(sky, seeded(6)); assert.ok(sky.foes.every((f) => f.y >= 6 && f.y < 200 && f.x >= 300)); // they come in from the right edge
  for (const g of [snake, stack, space]) { const sc = screen(300, 200), st = g.init(seeded(7), 300, 200); g.draw(sc, st); assert.ok(sc.b.some(Boolean)); }
}
// The game sits in a tab's split tree as a pane with a negative id, like any terminal.
{
  const t = split({ id: 3 }, 3, -1, 'row');
  assert.equal(JSON.stringify(leaves(t)), '[3,-1]');
  assert.equal(JSON.stringify(remove(t, -1)), '{"id":3}');
}

// --- Onboarding (onboarding.js, browser script): three cards, and every tour step points at something real ---
const ob = { window: {} };
runInNewContext(readFileSync(new URL('./onboarding.js', import.meta.url), 'utf8'), ob);
const { CARDS, STEPS } = ob.window.Onboarding;
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.equal(CARDS.length, 3);
for (const c of CARDS) assert.ok(c.title && c.text && c.expression, c.title);
assert.equal(STEPS.length, 6);
for (const s of STEPS) {
  assert.ok(s.title && s.text && ['inside', 'right', 'below'].includes(s.place), s.title);
  for (const sel of s.targets) {
    const [, tag, kind, name] = sel.match(/^([a-z\d]*)([#.])([\w-]+)$/);
    const attr = kind === '#' ? `id="${name}"` : `class="${name}"`;
    assert.ok(page.includes(tag ? `<${tag} ${attr}` : attr), `tour target ${sel} is not in index.html`);
  }
}
for (const id of ['welcomeOv', 'welcomeBlob', 'welcomeTitle', 'welcomeText', 'welcomeDots', 'welcomeNext', 'welcomeSkip', 'replayTour'])
  assert.ok(page.includes(`id="${id}"`), id);

// --- Anonymous usage (analytics.mjs): only allow-listed tools and plain values; nothing when off ---
const { createAnalytics, toolOf } = await import('./analytics.mjs');
assert.equal(toolOf('claude'), 'claude');
assert.equal(toolOf('git'), 'git');
assert.equal(toolOf('my-secret-script.sh'), 'other');
assert.equal(toolOf(''), 'other');
assert.equal(toolOf(undefined), 'other');
const usageDir = fresh(), sent = [];
const usage = createAnalytics({ dir: usageDir, props: { app_version: '9.9.9' }, send: (b) => sent.push(...b) });
assert.ok(usage.firstLaunch && usage.isOn());
usage.track('command_run', { tool: 'rm-client-files', source: 'typed', path: { nested: 'no' }, long: 'x'.repeat(500) });
usage.track('Bad Event!', {});
await usage.flush();
assert.equal(sent.length, 1);
const [ev] = sent;
assert.equal(ev.event, 'command_run');
assert.equal(ev.properties.tool, 'other');
assert.equal(ev.properties.source, 'typed');
assert.equal(ev.properties.app_version, '9.9.9');
assert.ok(!('path' in ev.properties) && ev.properties.long.length === 60);
assert.match(ev.distinct_id, /^[0-9a-f-]{36}$/);
usage.track('tab_opened');
usage.setOn(false); // turning it off drops anything not yet sent
usage.track('tab_opened');
await usage.flush();
assert.equal(sent.length, 1);
const again = createAnalytics({ dir: usageDir, props: {}, send: () => {} }); // same install: same ID, still off
assert.ok(!again.firstLaunch && !again.isOn());

// --- Versions (version.mjs): the update pill only offers something newer; betas come before their final ---
const { newer, bump } = await import('./version.mjs');
assert.ok(newer('0.2.1', '0.2.0'));
assert.ok(newer('0.10.0', '0.9.9'));
assert.ok(!newer('0.2.0', '0.2.0'));
assert.ok(!newer('0.2.0', '0.2.1'));
assert.ok(newer('0.3.0', '0.3.0-beta.2') && newer('0.3.0-beta.2', '0.3.0-beta.1'));
assert.ok(!newer('0.3.0-beta.1', '0.3.0') && newer('0.3.0-beta.1', '0.2.1'));
assert.ok(!newer('nonsense', '0.1.0') && !newer('0.2.0', 'nonsense'));
assert.equal(bump('0.2.0', 'patch'), '0.2.1');
assert.equal(bump('0.2.1', 'minor'), '0.3.0');
assert.equal(bump('0.9.3', 'major'), '1.0.0');
assert.equal(bump('0.2.1', 'beta'), '0.3.0-beta.1');
assert.equal(bump('0.3.0-beta.1', 'beta'), '0.3.0-beta.2');
assert.equal(bump('0.3.0-beta.2', 'minor'), '0.3.0');

{
// --- Reopening (session.mjs): a damaged or stale session.json can only ever mean "start fresh" ---
const { clean, countPanes, MAX_SCREEN } = await import('./session.mjs');
const here = fresh(), ctx = { exists: (p) => p === here, home: '/Users/me' };
const good = { v: 1, enabled: true, savedAt: 1, windows: [{
  bounds: { x: 10, y: 20, width: 1200, height: 760 }, tabIx: 1, side: { hidden: true, width: 999 },
  tabs: [
    { active: 0, root: { cwd: here } },
    { active: 5, root: { dir: 'row', ratio: 7, a: { cwd: '/gone/away', claude: true, screen: 'hi' }, b: { dir: 'col', a: { cwd: here }, b: { nope: 1 } } } },
  ] }] };
const c = clean(good, ctx);
assert.equal(c.windows.length, 1);
const [w] = c.windows;
assert.deepEqual(w.side, { hidden: true, width: 420 });            // width clamped to what the grip allows
assert.equal(w.tabIx, 1);
const t2 = w.tabs[1].root;
assert.equal(t2.ratio, 0.85);                                      // ratio clamped like a divider drag
assert.equal(t2.a.cwd, '/Users/me');                               // missing folder -> home
assert.ok(t2.a.claude && t2.a.screen === 'hi');
assert.deepEqual(t2.b, { cwd: here });                             // a broken half: its sibling takes its place
assert.equal(countPanes(t2), 2);
assert.equal(w.tabs[1].active, 1);                                 // active pane clamped to what exists
for (const bad of [null, 'x', { v: 99, windows: good.windows }, { v: 1, windows: 'no' }, { v: 1, windows: [{ tabs: [{ root: {} }] }] }])
  assert.equal(clean(bad, ctx).windows.length, 0);
assert.equal(clean({ v: 1, enabled: false, windows: [] }, ctx).enabled, false);
assert.equal(clean(null, ctx).enabled, true);                      // no file yet: on by default
const long = 'line\n'.repeat(MAX_SCREEN / 4);
const trimmed = clean({ v: 1, windows: [{ tabs: [{ root: { cwd: here, screen: long } }] }] }, ctx).windows[0].tabs[0].root.screen;
assert.ok(trimmed.length <= MAX_SCREEN && trimmed.startsWith('line\n'));   // keeps the end, cut at a line
assert.equal(clean({ v: 1, windows: [{ bounds: { x: 0, y: 0, width: 50, height: 50 }, tabs: [{ root: { cwd: here } }] }] }, ctx).windows[0].bounds, undefined);

}

// --- "What went wrong?" without AI (errors.mjs): every sample lands on its own entry, with the right fix ---
{
  const { ERRORS, NOT_ERRORS, diagnose } = await import('./errors.mjs');
  const ids = new Set();
  for (const e of ERRORS) {
    assert.ok(!ids.has(e.id), `errors.mjs: "${e.id}" is used twice`);
    ids.add(e.id);
    assert.ok(e.samples?.length, `errors.mjs: "${e.id}" needs at least one sample`);
    for (const s of e.samples) {
      const { out, ctx, ...want } = typeof s === 'string' ? { out: s } : s;
      const r = diagnose(out, ctx);
      assert.equal(r?.id, e.id, `errors.mjs: this sample should be "${e.id}" but got "${r?.id}":\n${out}`);
      if ('fix' in want) assert.equal(r.fix, want.fix, `errors.mjs: "${e.id}" fix`);
      assert.ok(r.text && !/undefined/.test(r.text), `errors.mjs: "${e.id}" text reads "${r.text}"`);
    }
  }
  for (const out of NOT_ERRORS) assert.equal(diagnose(out), null, `errors.mjs: normal output was taken for an error:\n${out}`);
  assert.equal(diagnose(''), null);
  const { looksLikeCommand } = await import('./errors.mjs');
  for (const ok of ['npm install', 'git push -u origin main', 'ls', './build.sh', 'NODE_ENV=production npm run build', 'cd ~/site && npm i'])
    assert.ok(looksLikeCommand(ok), ok);
  for (const no of ['Run the command again and share the exact command text you typed.', 'Check your Wi-Fi.', '', undefined, 'Open VS Code'])
    assert.ok(!looksLikeCommand(no), String(no));
}

// --- Jev (jev.mjs): its two questions cover every preset and every known error; it goes through Fork's server, no key in the app ---
{
  const { ERRORS, explainEntry } = await import('./errors.mjs');
  const { commandQuestion, errorQuestion, judge, INSTRUCTIONS } = await import('./jev.mjs');
  const { PALETTE, shape } = await import('./suggest.mjs');
  for (const p of PALETTE) { // ⌘K: every blank ({1}, {2}) has a field to type it in, and every field is used
    const blanks = [...p.cmd.matchAll(/\{(\d)\}/g)].map((m) => +m[1]);
    assert.deepEqual(blanks, (p.fill || []).map((_, i) => i + 1), `⌘K "${p.label}": blanks and fields don't line up`);
  }
  for (const ctx of [{}, { scripts: ['build'], hasNodeModules: true, hasBrew: true, hasGh: true }])
    for (const e of ERRORS) {
      const r = explainEntry(e.id, ctx); // what's shown when Jev picks this entry: no names or ports to fill in
      assert.ok(r.text && !/undefined|""/.test(`${r.text} ${r.fix}`), `errors.mjs: "${e.id}" without a match reads "${r.text}" / ${r.fix}`);
    }
  const cq = commandQuestion(PALETTE.map((p) => ({ ...p, cmd: shape(p) }))), eq = errorQuestion(ERRORS, (id) => explainEntry(id).text);
  assert.deepEqual(Object.keys(cq.criteria), [...PALETTE.map((p) => p.label), 'none']);
  assert.ok(!/\{\d\}/.test(JSON.stringify(cq)), 'Jev sees named blanks (mkdir <Folder name>), not {1}');
  assert.deepEqual(Object.keys(eq.criteria), [...ERRORS.map((e) => e.id), 'none']);
  // judge against a stand-in for Fork's server: its answer, or null when the server fails, is slow or is down
  const { createServer } = await import('node:http');
  let reply = (res) => res.end(JSON.stringify({ choice: 'Go up a folder', confidence: 0.8 })), got;
  const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got = JSON.parse(b); reply(res); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  assert.deepEqual(await judge({ request: 'up one' }, cq, undefined, url), { choice: 'Go up a folder', confidence: 0.8 });
  assert.deepEqual(got, { state: { request: 'up one' }, question: cq }); // only the text and the question: no key
  reply = (res) => { res.statusCode = 502; res.end('{}'); };
  assert.equal(await judge({ request: 'x' }, cq, undefined, url), null);
  reply = (res) => res.end('{}'); // "nothing fits"
  assert.equal(await judge({ request: 'x' }, cq, undefined, url), null);
  srv.close();
  assert.equal(await judge({ request: 'x' }, cq, undefined, url), null); // server gone
  // The website only accepts Fork's exact instructions: keep its copy in step (when fork-website is next door).
  const route = join(dirname(fileURLToPath(import.meta.url)), '../fork-website/app/api/jev/route.ts');
  if (existsSync(route)) for (const i of Object.values(INSTRUCTIONS))
    assert.ok(readFileSync(route, 'utf8').includes(JSON.stringify(i)), `fork-website's api/jev doesn't accept: ${i}`);
  // No TypeSafe key anywhere Fork ships from.
  const { execFileSync } = await import('node:child_process');
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && existsSync(f) && !/\.(png|jpe?g|gif|mp4|icns|dmg)$/.test(f));
  for (const f of tracked) assert.ok(!/apikey_[A-Za-z0-9]{16,}/.test(readFileSync(f, 'utf8')), `${f} contains what looks like a TypeSafe key`);
}

// --- Ask AI (claude.mjs): Claude's reply becomes plain lines, code fences and blank lines dropped ---
{
  const { toLines } = await import('./claude.mjs');
  assert.deepEqual(toLines('```zsh\ndu -sh .\n```\n\nShows the size of this folder.'), ['du -sh .', 'Shows the size of this folder.']);
}

// --- Dashboard (scripts/dashboard-charts.mjs): every event Fork sends is on a chart ---
{
  const { chartedEvents, NOT_CHARTED } = await import('./scripts/dashboard-charts.mjs');
  // Event names in the first argument of each track( call, e.g. track(r.done ? 'welcome_done' : 'welcome_skipped', …).
  // Only the first argument: values like { kind: 'ask_claude' } aren't events.
  const sentEvents = (src) => {
    const out = new Set();
    for (const m of src.matchAll(/\btrack\(/g)) {
      let i = m.index + m[0].length, depth = 0, arg = '';
      for (; i < src.length; i++) {
        const ch = src[i];
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) { if (!depth) break; depth--; }
        if (ch === ',' && !depth) break;
        arg += ch;
      }
      for (const [, name] of arg.matchAll(/'([a-z]+(?:_[a-z]+)*)'/g)) out.add(name);
    }
    return out;
  };
  assert.deepEqual([...sentEvents("dt.track(r.done ? 'welcome_done' : 'welcome_skipped', { card: 'x_y' }); dt.track('brand_new_event');")],
    ['welcome_done', 'welcome_skipped', 'brand_new_event']);
  assert.deepEqual([...sentEvents("dt.track('palette_used', { kind: 'ask_claude', ok: !!r });")], ['palette_used']);
  const charted = chartedEvents();
  const sent = new Set(['renderer.js', 'main.js', 'onboarding.js'].flatMap((f) => [...sentEvents(readFileSync(f, 'utf8'))]));
  assert.ok(sent.size > 20, 'found the events Fork sends');
  for (const e of sent) assert.ok(charted.has(e) || e in NOT_CHARTED,
    `Fork sends "${e}" but no dashboard chart shows it. Add it to scripts/dashboard-charts.mjs (or NOT_CHARTED with a reason).`);
}

console.log('check ok');
