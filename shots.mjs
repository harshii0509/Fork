// Before and after: a picture of your app when an agent starts a turn and another when it's done, kept when the
// turn changed something you can see. main.js takes the pictures; this keeps them, per workspace folder, in
// <userData>/shots/<folder hash>/ with an index.json. Pure helpers (changedFiles, isFrontend) are tested by check.mjs.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP = 20; // turns per workspace; pinned ones are kept on top of these

// Files an agent can change that show up on screen: styles, markup, components, images, fonts.
const FRONTEND = /\.(css|scss|sass|less|pcss|html?|jsx?|tsx?|mjs|vue|svelte|astro|mdx|svg|png|jpe?g|gif|webp|avif|woff2?)$/i;
const NOT_UI = /(^|\/)(\.?[\w-]+\.config\.[\w]+|package(-lock)?\.json|[\w.-]+\.(test|spec)\.[\w]+|__tests__\/.*|tests?\/.*)$/i;
export const isFrontend = (path) => FRONTEND.test(path) && !NOT_UI.test(path);

// Which files changed between two snapshots ({ path: 'status:mtime:size' } from main.js changes:snap):
// new to the list, gone from it, or the same file touched again.
export function changedFiles(before, after) {
  if (!before || !after) return null; // not a git folder: can't tell
  const out = [];
  for (const [p, s] of Object.entries(after)) if (before[p] !== s) out.push(p);
  for (const p of Object.keys(before)) if (!(p in after)) out.push(p); // reverted or deleted
  return out;
}

export const hashOf = (buf) => createHash('sha1').update(buf).digest('hex');
const folderOf = (base, dir) => join(base, createHash('sha1').update(String(dir)).digest('hex').slice(0, 12));

export function shotStore(base) {
  const index = (dir) => join(folderOf(base, dir), 'index.json');
  const list = (dir) => {
    try { const l = JSON.parse(readFileSync(index(dir), 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; }
  };
  const save = (dir, turns, gone = []) => {
    const d = folderOf(base, dir);
    mkdirSync(d, { recursive: true });
    writeFileSync(index(dir), JSON.stringify(turns));
    for (const t of gone) for (const f of [t.before, t.after]) if (f?.startsWith(d + '/')) rmSync(f, { force: true });
    // Strays (a before whose turn changed nothing, if Fork quit before dropping it): half a day old, gone. Never
    // fresher ones: that may be the before of a turn still running in another terminal here.
    const used = new Set(turns.flatMap((t) => [t.before, t.after])), old = Date.now() - 12 * 3600e3;
    try { for (const f of readdirSync(d)) if (f.endsWith('.png') && !used.has(join(d, f)) && Number(f.split('-')[0]) < old) rmSync(join(d, f), { force: true }); } catch {}
  };
  return {
    list,
    // Write a picture for this workspace; returns its path. Not in the index until a turn uses it (add).
    write(dir, buf, label) {
      const d = folderOf(base, dir);
      mkdirSync(d, { recursive: true });
      const path = join(d, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${label}.png`);
      writeFileSync(path, buf);
      return path;
    },
    drop(dir, path) { if (String(path).startsWith(folderOf(base, dir) + '/')) rmSync(path, { force: true }); },
    // Newest first. Beyond KEEP, the oldest unpinned turns go, with their pictures.
    add(dir, turn) {
      const turns = [turn, ...list(dir).filter((t) => t.id !== turn.id)];
      let n = 0;
      const kept = turns.filter((t) => t.pinned || ++n <= KEEP);
      save(dir, kept, turns.filter((t) => !kept.includes(t)));
      return kept;
    },
    pin(dir, id, on) {
      const turns = list(dir).map((t) => (t.id === id ? { ...t, pinned: !!on } : t));
      save(dir, turns);
      return turns;
    },
    remove(dir, id) {
      const all = list(dir), turns = all.filter((t) => t.id !== id);
      save(dir, turns, all.filter((t) => t.id === id));
      return turns;
    },
  };
}
