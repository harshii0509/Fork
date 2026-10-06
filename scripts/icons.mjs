// Fork's icons are Central Icons (centralicons.com), a paid set: the licence allows them inside the app but not
// shared on the web, and this repo is public. So only their names are committed (icons/central.json); this
// script draws the SVGs on your Mac into icons/central/, which git ignores and the app build still packages.
// A clone without the key falls back to the open icons (Phosphor in icons/ph, Lucide in icons.js).
//
// Needs the licence key in ~/.config/fork/central.env (CENTRAL_LICENSE_KEY=…), never in the repo or the app.
// Run `npm run icons` after changing icons/central.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAP = JSON.parse(readFileSync(new URL('../icons/central.json', import.meta.url), 'utf8'));
const OUT = new URL('../icons/central/', import.meta.url).pathname;
const ENV = join(homedir(), '.config/fork/central.env');
const KEY = existsSync(ENV) && readFileSync(ENV, 'utf8').match(/^CENTRAL_LICENSE_KEY=(.+)$/m)?.[1].trim();
if (!KEY) throw new Error(`No Central Icons licence key. Put CENTRAL_LICENSE_KEY=… in ${ENV}`);

// The package lives outside the repo, so Fork's own npm install never needs the key.
const CACHE = join(homedir(), '.cache/fork-central');
const spec = `${MAP.package}@${MAP.version}`;
mkdirSync(CACHE, { recursive: true });
const want = { private: true, dependencies: { [MAP.package]: MAP.version, react: '19.2.0', 'react-dom': '19.2.0' } };
const pkgFile = join(CACHE, 'package.json');
if (!existsSync(pkgFile) || readFileSync(pkgFile, 'utf8') !== JSON.stringify(want)) {
  writeFileSync(pkgFile, JSON.stringify(want));
  console.log(`Installing ${spec}…`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: CACHE, stdio: 'inherit',
    env: { ...process.env, CENTRAL_LICENSE_KEY: KEY } });
}

const require = createRequire(join(CACHE, 'index.js'));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const names = Object.entries(MAP.icons);
if (names.length > 300) throw new Error(`${names.length} icons: the licence allows 300 per style in one app`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const [fork, central] of names) {
  let Icon;
  try { Icon = require(`${MAP.package}/${central}`)[central]; } catch {}
  if (!Icon) throw new Error(`${central} (for "${fork}") isn't in ${spec}`);
  // Black lines on transparent: the app draws each one as a mask over the text colour (.ph in index.html). React
  // wraps the lines in an SVG <mask> (for its see-through colours); keep just the lines.
  const html = renderToStaticMarkup(createElement(Icon, { size: 24, color: '#000' }));
  const lines = html.match(/<g fill="none" style="color:#fff">([^]*)<\/g><\/mask>/)?.[1]
    ?? html.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  writeFileSync(join(OUT, `${fork}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" style="color:#000">${lines}</svg>\n`);
}
writeFileSync(join(OUT, 'ready.js'), 'window.CENTRAL = true;\n');
console.log(`Drew ${names.length} Central icons into icons/central/ (git ignores them).`);
