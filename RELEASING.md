# Releasing Fork

How versions are numbered, how a release goes out, and the road to 1.0.
How the pieces work underneath (DMG, `install.sh`, the update pill, signing) is in [DISTRIBUTION.md](DISTRIBUTION.md).

---

## 1. Version numbers

`MAJOR.MINOR.PATCH`, e.g. `0.2.1`.

| Change | Bump | Example |
|---|---|---|
| Fixes and small tweaks | **patch** | 0.2.0 → 0.2.1 |
| New features, or anything people will notice | **minor** | 0.2.1 → 0.3.0 |
| Something that changes habits or needs a reinstall | **major** | 1.4.2 → 2.0.0 |

**1.0.0 is the fresh start:** the first Fork signed and notarized by Apple, and the first that updates itself. The rename, which needs a reinstall, will be a major (2.0.0).

**Betas** are `X.Y.Z-beta.N`, e.g. `0.3.0-beta.1`. They're published as GitHub *prereleases*, and installed Forks only update to the latest normal release, so regular users are never offered a beta. Testers install a beta from its own DMG link. When the final `0.3.0` comes out, testers get it like everyone else (`version.mjs` knows `0.3.0` is newer than `0.3.0-beta.2`).

## 2. Day to day

- **`main` is always ready to ship.** Releases only come from `main`. Bigger work goes on a branch and merges when it's done.
- **Write the changelog as you go.** Every change people will notice gets a plain-English line under `### Unreleased` in [CHANGELOG.md](CHANGELOG.md), grouped as **New**, **Better** and **Fixed**. That text is exactly what people read in the update card and in What's new, so write it for them. Changes only developers see stay out of it; the git history has those.
- **And on What's cooking.** Every change, big or small (developer-only ones too), also gets an entry on the website's changelog, [fork-terminal.vercel.app/whats-cooking](https://fork-terminal.vercel.app/whats-cooking): `app/whats-cooking/entries.ts` in the [fork-website](https://github.com/harshii0509/fork-website) repo, with when it landed, what changed and why. After a release, add its version to the entries it shipped and to `RELEASES` there.
- **`install.sh` is live the moment it's pushed.** "Update and restart" downloads it straight from `main`, so a mistake there breaks updates for everyone. Run `bash install.sh` locally before pushing a change to it.
- **Rhythm: ship once or twice a week, not after every fix.** Every release asks everyone to restart, so keep adding to **Unreleased** and ship them together. Ship straight away only when something's broken (Fork won't open, updating fails, data at risk). A minor roughly every one to two weeks when there are features.

### Before every release (the checklist)
Claude stops and says so if any of these is missing when you ask for a release:
1. **Is it time?** Has it been a few days since the last release, or is something broken? If neither, wait and keep collecting.
2. **Used in the real app, not just written.** The change has been run in the app (with `npm start`, a test copy, or Fork Dev once it exists, [#15](https://github.com/harshii0509/Fork/issues/15)), not just tested by `npm run check`.
3. **Unreleased reads right.** Plain words, for the people updating, and it says **Fork**, never the old package name.
4. **From `main`, committed.** Never from a branch or worktree such as `ui-redesign`.
5. **Dry run first.** `npm run release -- patch --dry-run`, and read the notes it shows.
6. **After it's out:** mark the shipped entries on What's cooking with the version, and add it to `RELEASES` there.

## 3. Shipping a release

Commit your work first, then:

    npm run release -- patch --dry-run   # practise: shows the new version and notes, changes nothing
    npm run release -- patch             # or minor, major, beta

The script stops with a plain message at the first problem. In order, it:

1. Checks you're on `main`, nothing is uncommitted, you're up to date with GitHub, `gh` is logged in, `npm run check` passes, and **Unreleased** isn't empty.
2. Works out the new version from `package.json`:
   - `beta` on a normal version starts the next minor's betas (0.2.1 → 0.3.0-beta.1).
   - On a beta it counts up (beta.1 → beta.2).
   - `patch` or `minor` on a beta finishes it (0.3.0-beta.2 → 0.3.0).
3. Moves **Unreleased** in CHANGELOG.md under a `### X.Y.Z — date` heading and uses it as the release notes. A beta leaves **Unreleased** in place, so the final release carries everything.
4. Bumps `package.json`, then runs `npm run dist`.
5. Checks the build: `Fork.dmg` exists, the shell files are inside, it's signed, and the app reports the new version. If anything fails, it puts `package.json` and CHANGELOG.md back.
6. Commits `Fork X.Y.Z`, tags `vX.Y.Z`, pushes both, and publishes the GitHub release with `Fork.dmg`.
7. Confirms GitHub's "latest" is the new version and the download link works.

People then see the **Fork X.Y.Z** pill within the hour (Fork checks hourly and when you switch back to it) and get the notes as What's new after updating.

## 4. The PostHog dashboard

"Fork — how it's going" (https://us.posthog.com/project/388234/dashboard/2139445) shows installs, the first run, and what people use. Its charts are defined in `scripts/dashboard-charts.mjs`.

- **Every release updates it** as a last step. Charts are matched by name, so the link never changes. If that step fails, the release is still fine; fix the problem, then run `npm run dashboard`.
- **Adding an event?** `npm run check` fails until the event is on a chart in `scripts/dashboard-charts.mjs`, or listed in `NOT_CHARTED` with a reason. Then `npm run dashboard` (or the next release) puts it live.
- **Key:** a PostHog personal API key in `~/.config/fork/posthog-key` (chmod 600), with scopes Project read, Dashboard write, Insight write and Query read. It's never kept in the repo.

## 5. When a release is broken

Updates only ever go to a *newer* version, so there's no way to move people back. And since 1.0 Forks download updates by themselves within the hour, a broken release spreads fast. Instead:

1. **Really bad** (Fork won't open, or updating fails)? Delete that release on GitHub straight away: `gh release delete vX.Y.Z --cleanup-tag`. The "latest" link then serves the previous version to anyone installing. Also run `git tag -d vX.Y.Z`.
2. Fix it, add a **Fixed** line under Unreleased, and ship the next patch. Everyone who got the broken one updates to it.

## 6. Roadmap

| Stage | Versions | What ships | Move on when |
|---|---|---|---|
| **Polish** | 0.3 – 0.4 | ~~Tabs and splits restored after a relaunch, ⌘F search, clickable links, faster drawing (WebGL), 10,000 lines of history~~ (0.3). Claude Code setup inside onboarding for people who don't have it. A privacy page saying what goes to PostHog and what goes to Anthropic. A "not affiliated with Anthropic" line. | Someone new to terminals installs Fork and finishes a real task without help. |
| **Private beta** | 0.5 – 0.9 | 10–30 designers testing. A new name, because Fork clashes with fork.dev. ~~An Apple Developer ID ($99/yr), notarization and automatic updates (electron-updater)~~ (1.0.0). Releases move to a GitHub Action holding the signing keys. A Homebrew tap. | No scary macOS warning, updates happen quietly, and testers' main complaints are fixed. |
| **Launch** | 1.x – 2.0 | Landing page with a short demo video. Product Hunt and X first, then Show HN once installing is smooth. | |
| **After** | 1.x | A "Claude needs you" blob, translations, an Intel build. | |

**Signing and automatic updates went out first (1.0.0), under the name Fork.** It kept the app ID `com.forkterminal.app`, so the old update pill brought everyone across and nobody had to reinstall. The rename still changes the app's ID and where it installs, so it'll be 2.0.0 with one "please reinstall" note, the same as 0.1 → 0.2.

Background for these choices: the research page "Fork vs the World" (claude.ai artifact) compares Fork with 11 terminals and 9 AI coding tools.
