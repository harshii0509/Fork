// npm run release -- patch|minor|major|beta [--dry-run]
// Ships a new Fork: checks, bumps the version, turns "### Unreleased" in CHANGELOG.md into the
// release notes, builds, checks the build, tags, pushes and publishes on GitHub. See RELEASING.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bump, parse } from '../version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'harshii0509/Fork';
const LATEST_DMG = `https://github.com/${REPO}/releases/latest/download/Fork.dmg`;
const APP = join(ROOT, 'dist/mac-arm64/Fork.app');
const DMG = join(ROOT, 'dist/Fork.dmg');
// The App Store Connect API key Apple notarizes with. Never in the repo. See DISTRIBUTION.md §3.
const NOTARY = join(homedir(), '.config/fork/notary.env');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const kind = args.find((a) => !a.startsWith('--'));

const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', ...opts });
const quiet = (cmd, a) => run(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const loud = (cmd, a) => run(cmd, a, { stdio: 'inherit' });
const step = (s) => console.log(`\n→ ${s}`);
const stop = (why) => { console.error(`\n✗ ${why}`); process.exit(1); };
const problem = (why) => (dry ? console.log(`  ! ${why} (fine for a dry run, but a real release stops here)`) : stop(why));

if (!['patch', 'minor', 'major', 'beta'].includes(kind)) {
  stop('Say what kind of release: npm run release -- patch | minor | major | beta   (add --dry-run to practise)');
}

// --- 1. Checks -------------------------------------------------------------------------------------
step('Checking everything is ready');
if (quiet('git', ['branch', '--show-current']) !== 'main') problem('Releases only come from main. Switch to main first.');
if (quiet('git', ['status', '--porcelain'])) problem('There are unsaved changes. Commit them (or stash them) first.');
try { quiet('git', ['fetch', 'origin', '--tags', '--quiet']); } catch { stop("Couldn't reach GitHub. Are you online?"); }
const [behind, ahead] = quiet('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD']).split(/\s+/).map(Number);
if (behind) problem(`main is ${behind} commit(s) behind GitHub. Run git pull first.`);
if (ahead) console.log(`  ${ahead} commit(s) not on GitHub yet; they'll be pushed with the release.`);
try { quiet('gh', ['auth', 'status']); } catch { stop('The GitHub CLI isn\'t logged in. Run: gh auth login'); }
if (!existsSync(NOTARY)) problem(`The notarization key isn't set up (${NOTARY} is missing). See DISTRIBUTION.md §3.`);
else for (const [, k, v] of readFileSync(NOTARY, 'utf8').matchAll(/^(APPLE_API_\w+)=(.*)$/gm)) process.env[k] = v.trim();
// Neither is committed: the Central icons are paid, and vendor/ is bundled by npm install. Without them the
// build still works but ships fallback icons and no Changes tab.
if (!existsSync(join(ROOT, 'icons/central/ready.js'))) problem("The Central icons aren't built. Run: npm run icons");
if (!existsSync(join(ROOT, 'vendor/diffs'))) problem("vendor/ isn't built. Run: npm install");
if (quiet('security', ['find-identity', '-v', '-p', 'codesigning']).indexOf('Developer ID Application') < 0) {
  problem('The Developer ID certificate isn\'t in this Mac\'s Keychain. See DISTRIBUTION.md §3.');
}
try { quiet('npm', ['run', 'check']); } catch (e) { stop(`npm run check failed:\n${e.stdout || ''}${e.stderr || ''}`); }
console.log('  check ok');

// --- 2. The new version ----------------------------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = bump(pkg.version, kind);
const beta = parse(version).beta !== null;
const tag = `v${version}`;
if (quiet('git', ['tag', '--list', tag])) stop(`${tag} already exists. Did this release already go out?`);
step(`Fork ${pkg.version} → ${version}${beta ? ' (beta: only people with the link get it)' : ''}`);

// --- 3. Release notes from CHANGELOG.md ------------------------------------------------------------
// "### Unreleased" runs until the next heading of the same or higher level.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const m = /^### Unreleased[^\n]*\n([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/m.exec(changelog);
if (!m) stop('CHANGELOG.md has no "### Unreleased" section. Add one under "## Changelog".');
const notes = m[1].trim();
if (!notes) stop('"### Unreleased" in CHANGELOG.md is empty. Write what changed, in plain words, first.');
const date = new Date().toISOString().slice(0, 10);
// A beta leaves Unreleased alone, so the final release carries everything since the last one.
const nextChangelog = beta ? changelog
  : changelog.replace(m[0], `### Unreleased\n\n### ${version} — ${date}\n${m[1].replace(/^\n*/, '\n')}`);
console.log(`\n${notes.replace(/^/gm, '  │ ')}`);

if (dry) {
  const d = mkdtempSync(join(tmpdir(), 'fork-release-'));
  writeFileSync(join(d, 'CHANGELOG.md'), nextChangelog);
  console.log(`\nDry run: nothing changed. The CHANGELOG as it would be: ${join(d, 'CHANGELOG.md')}`);
  console.log(`A real run would: bump package.json to ${version}, build, commit "Fork ${version}", tag ${tag},`);
  console.log(`push to GitHub and publish the release${beta ? ' as a prerelease' : ''}.`);
  process.exit(0);
}

// --- 4. Bump + CHANGELOG ---------------------------------------------------------------------------
step('Updating package.json and CHANGELOG.md');
quiet('npm', ['version', version, '--no-git-tag-version']);
writeFileSync(join(ROOT, 'CHANGELOG.md'), nextChangelog);
const undo = () => { try { quiet('git', ['checkout', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md']); } catch {} };

// --- 5. Build --------------------------------------------------------------------------------------
step('Building Fork.dmg and having Apple notarize it (takes 5–10 minutes)');
rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
try { loud('npm', ['run', 'dist']); } catch { undo(); stop('The build failed (see above). package.json and CHANGELOG.md are back as they were.'); }

// --- 6. Check the build ----------------------------------------------------------------------------
step('Checking the build');
const fail = (why) => { undo(); stop(`${why}\npackage.json and CHANGELOG.md are back as they were. Nothing was published.`); };
if (!existsSync(DMG)) fail('dist/Fork.dmg is missing.');
const shell = join(APP, 'Contents/Resources/app.asar.unpacked/shell');
for (const f of ['.zshrc', '.zprofile', '.zshenv']) if (!existsSync(join(shell, f))) fail(`The app is missing shell/${f}.`);
const sig = spawnSync('codesign', ['-dv', '--verbose=2', APP], { encoding: 'utf8' }).stderr; // codesign -dv reports on stderr
if (!/Authority=Developer ID Application/.test(sig)) fail('The app isn\'t signed with the Developer ID.');
// electron-builder notarized the app; the DMG around it gets its own ticket, so it opens without a check online.
const notary = ['--key', process.env.APPLE_API_KEY, '--key-id', process.env.APPLE_API_KEY_ID, '--issuer', process.env.APPLE_API_ISSUER];
try { loud('xcrun', ['notarytool', 'submit', DMG, ...notary, '--wait']); loud('xcrun', ['stapler', 'staple', DMG]); } catch { fail('Apple didn\'t notarize Fork.dmg (see above).'); }
const gk = spawnSync('spctl', ['-a', '-vv', APP], { encoding: 'utf8' }).stderr; // spctl reports on stderr too
if (!/source=Notarized Developer ID/.test(gk)) fail(`Gatekeeper doesn't accept the app as notarized:\n${gk}`);
const built = quiet('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(APP, 'Contents/Info.plist')]);
if (built !== version) fail(`The app says it's ${built}, not ${version}.`);
// What installed Forks update from (main.js): the zip, and the .yml that points at it. A beta writes beta-mac.yml,
// which nobody reads: installed Forks only follow latest-mac.yml, so betas stay link-only.
const ZIP = join(ROOT, `dist/Fork-${version}-arm64-mac.zip`);
const YML = join(ROOT, `dist/${beta ? 'beta' : 'latest'}-mac.yml`);
for (const f of [ZIP, `${ZIP}.blockmap`, YML]) if (!existsSync(f)) fail(`${f.slice(ROOT.length + 1)} is missing.`);
if (!readFileSync(YML, 'utf8').includes(`version: ${version}\n`)) fail(`${YML.slice(ROOT.length + 1)} isn't for ${version}.`);
const unzipped = mkdtempSync(join(tmpdir(), 'fork-zip-'));
quiet('ditto', ['-x', '-k', ZIP, unzipped]);
const zgk = spawnSync('spctl', ['-a', '-vv', join(unzipped, 'Fork.app')], { encoding: 'utf8' }).stderr;
rmSync(unzipped, { recursive: true, force: true });
if (!/source=Notarized Developer ID/.test(zgk)) fail(`The app in the update zip isn't notarized:\n${zgk}`);
console.log(`  Fork.dmg ok · update zip ok · shell files ok · signed and notarized · version ${built}`);

// --- 7. Publish ------------------------------------------------------------------------------------
step(`Publishing ${tag}`);
const assets = [DMG, ZIP, `${ZIP}.blockmap`, YML].map((f) => f.slice(ROOT.length + 1));
const notesFile = join(mkdtempSync(join(tmpdir(), 'fork-notes-')), 'notes.md');
writeFileSync(notesFile, notes + '\n');
quiet('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
quiet('git', ['commit', '-m', `Fork ${version}`]);
quiet('git', ['tag', tag]);
try { loud('git', ['push', 'origin', 'main', tag]); } catch {
  stop(`Pushing failed. The release commit and tag are made locally; fix the problem, then run:\n  git push origin main ${tag}\n  gh release create ${tag} ${assets.join(' ')} --title "Fork ${version}" --notes-file ${notesFile}${beta ? ' --prerelease' : ''}`);
}
try {
  loud('gh', ['release', 'create', tag, ...assets, '--repo', REPO, '--title', `Fork ${version}`,
    '--notes-file', notesFile, ...(beta ? ['--prerelease'] : ['--latest'])]);
} catch {
  stop(`The tag is pushed but the GitHub release wasn't made. Run:\n  gh release create ${tag} ${assets.join(' ')} --title "Fork ${version}" --notes-file ${notesFile}${beta ? ' --prerelease' : ''}`);
}

// --- 8. Is it live? --------------------------------------------------------------------------------
step('Checking it is live');
const url = quiet('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'url', '-q', '.url']);
if (beta) {
  console.log(`  Beta is up: ${url}`);
  console.log(`  Send testers the DMG: https://github.com/${REPO}/releases/download/${tag}/Fork.dmg`);
  console.log('  Regular users are not offered betas.');
} else {
  const latest = quiet('gh', ['api', `repos/${REPO}/releases/latest`, '-q', '.tag_name']);
  if (latest !== tag) stop(`GitHub says the latest release is ${latest}, not ${tag}. Check ${url}`);
  const head = quiet('curl', ['-fsSIL', '-o', '/dev/null', '-w', '%{http_code}', LATEST_DMG]);
  if (head !== '200') stop(`The download link answered ${head}, not 200: ${LATEST_DMG}`);
  let yml = '';
  try { yml = quiet('curl', ['-fsSL', `https://github.com/${REPO}/releases/latest/download/latest-mac.yml`]); } catch {}
  if (!yml.includes(`version: ${version}`)) stop(`latest-mac.yml on the release doesn't say ${version}, so installed Forks won't update. Check ${url}`);
  console.log(`  latest = ${tag} · download link ok · auto-update file ok`);
  console.log(`\n✓ Fork ${version} is out: ${url}`);
  console.log('  Everyone with Fork sees the update pill within the hour, or the next time they open it.');
  // Bring the PostHog dashboards in line with their chart files (app and website). Never fails the release.
  step('Updating the PostHog dashboard');
  const d = spawnSync('node', ['scripts/posthog-dashboard.mjs', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  console.log(`  ${(d.stdout + d.stderr).trim() || 'no output'}${d.status ? '\n  (The release is fine; run npm run dashboard once that\'s sorted.)' : ''}`);
}
