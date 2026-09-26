// npm run release -- patch|minor|major|beta [--dry-run]
// Ships a new Fork: checks, bumps the version, turns "### Unreleased" in CHANGELOG.md into the
// release notes, builds, checks the build, tags, pushes and publishes on GitHub. See RELEASING.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bump, parse } from '../version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'harshii0509/Fork';
const LATEST_DMG = `https://github.com/${REPO}/releases/latest/download/Fork.dmg`;
const APP = join(ROOT, 'dist/mac-arm64/Fork.app');

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
step('Building Fork.dmg (takes a minute)');
rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
try { loud('npm', ['run', 'dist']); } catch { undo(); stop('The build failed (see above). package.json and CHANGELOG.md are back as they were.'); }

// --- 6. Check the build ----------------------------------------------------------------------------
step('Checking the build');
const fail = (why) => { undo(); stop(`${why}\npackage.json and CHANGELOG.md are back as they were. Nothing was published.`); };
if (!existsSync(join(ROOT, 'dist/Fork.dmg'))) fail('dist/Fork.dmg is missing.');
const shell = join(APP, 'Contents/Resources/app.asar.unpacked/shell');
for (const f of ['.zshrc', '.zprofile', '.zshenv']) if (!existsSync(join(shell, f))) fail(`The app is missing shell/${f}.`);
const sig = spawnSync('codesign', ['-dv', APP], { encoding: 'utf8' }).stderr; // codesign -dv reports on stderr
if (!/Signature=adhoc|Authority=Developer ID/.test(sig)) fail('The app isn\'t signed.');
const built = quiet('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(APP, 'Contents/Info.plist')]);
if (built !== version) fail(`The app says it's ${built}, not ${version}.`);
console.log(`  Fork.dmg ok · shell files ok · signed · version ${built}`);

// --- 7. Publish ------------------------------------------------------------------------------------
step(`Publishing ${tag}`);
const notesFile = join(mkdtempSync(join(tmpdir(), 'fork-notes-')), 'notes.md');
writeFileSync(notesFile, notes + '\n');
quiet('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
quiet('git', ['commit', '-m', `Fork ${version}`]);
quiet('git', ['tag', tag]);
try { loud('git', ['push', 'origin', 'main', tag]); } catch {
  stop(`Pushing failed. The release commit and tag are made locally; fix the problem, then run:\n  git push origin main ${tag}\n  gh release create ${tag} dist/Fork.dmg --title "Fork ${version}" --notes-file ${notesFile}${beta ? ' --prerelease' : ''}`);
}
try {
  loud('gh', ['release', 'create', tag, 'dist/Fork.dmg', '--repo', REPO, '--title', `Fork ${version}`,
    '--notes-file', notesFile, ...(beta ? ['--prerelease'] : ['--latest'])]);
} catch {
  stop(`The tag is pushed but the GitHub release wasn't made. Run:\n  gh release create ${tag} dist/Fork.dmg --title "Fork ${version}" --notes-file ${notesFile}${beta ? ' --prerelease' : ''}`);
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
  console.log(`  latest = ${tag} · download link ok`);
  console.log(`\n✓ Fork ${version} is out: ${url}`);
  console.log('  Everyone with Fork sees the update pill within the hour, or the next time they open it.');
  // Bring the PostHog dashboard in line with the charts in scripts/dashboard-charts.mjs. Never fails the release.
  step('Updating the PostHog dashboard');
  const d = spawnSync('node', ['scripts/posthog-dashboard.mjs', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  console.log(`  ${(d.stdout + d.stderr).trim() || 'no output'}${d.status ? '\n  (The release is fine; run npm run dashboard once that\'s sorted.)' : ''}`);
}
