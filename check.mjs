// node check.mjs — the context-aware suggestions pick the right next step.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  'README.md': 'file-text', 'Inter.woff2': 'file-type', 'Makefile': 'file', 'archive.tar.gz': 'file-archive' };
for (const [name, icon] of Object.entries(kinds)) {
  assert.deepEqual({ ...ic.fileIcon(name) }, { icon }, name);
  assert.ok(ic.ICONS[icon], icon);
}

// --- Files: tree listing and what the preview shows (files.mjs) ---
const { list, readPreview } = await import('./files.mjs');
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

// --- The Bloub mascot bundle (vendor/bloub/bloub.js): loads standalone and draws the thinking pose ---
const bctx = { performance, setTimeout, clearTimeout };
runInNewContext(readFileSync(new URL('./vendor/bloub/bloub.js', import.meta.url), 'utf8'), bctx);
const bloub = new bctx.Bloub.BloubController({ state: 'thinking', color: '#7c6cff' });
const pose = bloub.sample(1);
assert.ok(pose.bodyPath.length > 20 && !/NaN|Infinity/.test(pose.bodyPath));
assert.ok(pose.dots.length >= 2 && pose.dots.every((d) => Number.isFinite(d.x + d.r)));
bloub.dispose();

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

console.log('check ok');
