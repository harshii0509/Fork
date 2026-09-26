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
| The public launch | **1.0.0** | signed, renamed, past the private beta |
| After 1.0: something that changes habits or needs a reinstall | **major** | 1.4.2 → 2.0.0 |

**Betas** are `X.Y.Z-beta.N`, e.g. `0.3.0-beta.1`. They're published as GitHub *prereleases*, and the update pill only looks at the latest normal release, so regular users are never offered a beta. Testers install a beta from its own DMG link. When the final `0.3.0` comes out, testers get the pill like everyone else (`version.mjs` knows `0.3.0` is newer than `0.3.0-beta.2`).

## 2. Day to day

- **`main` is always ready to ship.** Releases only come from `main`. Bigger work goes on a branch and merges when it's done.
- **Write the changelog as you go.** Every change people will notice gets a plain-English line under `### Unreleased` in [CHANGELOG.md](CHANGELOG.md), grouped as **New**, **Better** and **Fixed**. That text is exactly what people read in the update card and in What's new, so write it for them. Changes only developers see stay out of it; the git history has those.
- **`install.sh` is live the moment it's pushed.** "Update and restart" downloads it straight from `main`, so a mistake there breaks updates for everyone. Run `bash install.sh` locally before pushing a change to it.
- **Rhythm:** a patch whenever something's worth shipping. During the beta, a minor roughly every one to two weeks.

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

## 4. When a release is broken

The pill only ever offers a *newer* version, so there's no way to move people back. Instead:

1. **Really bad** (Fork won't open, or updating fails)? Delete that release on GitHub straight away: `gh release delete vX.Y.Z --cleanup-tag`. The "latest" link then serves the previous version to anyone installing. Also run `git tag -d vX.Y.Z`.
2. Fix it, add a **Fixed** line under Unreleased, and ship the next patch. Everyone who got the broken one updates to it.

## 5. Road to 1.0

| Stage | Versions | What ships | Move on when |
|---|---|---|---|
| **Polish** | 0.3 – 0.4 | ~~Tabs and splits restored after a relaunch~~ (0.3). ⌘F search, clickable links, faster drawing (WebGL), 10,000 lines of history. Claude Code setup inside onboarding for people who don't have it. A privacy page saying what goes to PostHog and what goes to Anthropic. A "not affiliated with Anthropic" line. | Someone new to terminals installs Fork and finishes a real task without help. |
| **Private beta** | 0.5 – 0.9 | 10–30 designers testing. A new name, because Fork clashes with fork.dev. An Apple Developer ID ($99/yr), notarization and silent updates (electron-updater). Releases move to a GitHub Action holding the signing keys. A Homebrew tap. | No scary macOS warning, updates happen quietly, and testers' main complaints are fixed. |
| **Launch** | 1.0.0 | Landing page with a short demo video. Product Hunt and X first, then Show HN once installing is smooth. | |
| **After** | 1.x | A "Claude needs you" blob, translations, an Intel build. | |

**Rename and signing go out together, in one release.** Both change the app's ID and where it installs. That means one "please reinstall" note, the same as 0.1 → 0.2, instead of two.

Background for these choices: the research page "Fork vs the World" (claude.ai artifact) compares Fork with 11 terminals and 9 AI coding tools.
