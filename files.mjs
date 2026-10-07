// The sidebar's file tree and what the preview panel shows. Main process only; check.mjs tests it.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { marked } from 'marked';

// Installed packages and build output: dimmed and sorted last, they're rarely what you're after.
export const NOISE = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'Pods', '__pycache__', 'target']);

export function list(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, folder: e.isDirectory(), noise: e.isDirectory() && NOISE.has(e.name) }))
      .sort((a, b) => b.folder - a.folder || a.noise - b.noise || a.name.localeCompare(b.name));
  } catch { return []; } // unreadable folder: show it empty rather than crash
}

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp']);
const VIDEO = new Set(['mp4', 'mov', 'm4v', 'webm']);
const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
const MAX = 1024 * 1024; // bigger than this is a lockfile or data dump, not something to read
// The code preview (@pierre/diffs, in the window) knows a file's language from its name; these it can't guess.
const LANG = { htm: 'html', svg: 'xml', env: 'dotenv' };
const NAMED = { dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby', podfile: 'ruby' };

// { kind: image | video | markdown | code | html | other | missing, size, html? (markdown), text? lang? lines? (code), why? }
export async function readPreview(path) {
  let size;
  try { size = statSync(path).size; } catch { return { kind: 'missing' }; }
  const ext = extname(path).slice(1).toLowerCase();
  if (IMAGE.has(ext)) return { kind: 'image', size };
  if (VIDEO.has(ext)) return { kind: 'video', size };
  if (size > MAX) return { kind: 'other', size, why: 'big' };
  const buf = readFileSync(path);
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'other', size, why: 'binary' };
  const text = buf.toString('utf8');
  if (MARKDOWN.has(ext)) return { kind: 'markdown', size, html: marked.parse(text) };
  const lang = LANG[ext] || NAMED[basename(path).toLowerCase()];
  return { kind: ext === 'html' || ext === 'htm' ? 'html' : 'code', size, text, ...(lang && { lang }),
    lines: text.replace(/\n$/, '').split('\n').length };
}

// A book for the side panel's Read view (reader.js): its bytes, or why not.
const BOOK = new Set(['pdf', 'epub']);
export const MAX_BOOK = 300 * 1024 * 1024;
export function readBook(path) {
  if (typeof path !== 'string' || !BOOK.has(extname(path).slice(1).toLowerCase())) return { error: 'kind' };
  let size;
  try { size = statSync(path).size; } catch { return { error: 'missing' }; }
  if (size > MAX_BOOK) return { error: 'big' };
  try { return { bytes: readFileSync(path) }; } catch { return { error: 'missing' }; }
}

// The code editor to hand real edits to: the first one installed.
const EDITORS = [['Cursor', 'Cursor'], ['Visual Studio Code', 'VS Code'], ['Zed', 'Zed'], ['Windsurf', 'Windsurf']];
export function findEditor() {
  const dirs = ['/Applications', join(homedir(), 'Applications')];
  const hit = EDITORS.find(([app]) => dirs.some((d) => existsSync(join(d, `${app}.app`))));
  return hit ? { app: hit[0], label: hit[1] } : null;
}

// The sidebar's search: files whose name has the words, then lines inside files that do (a find + grep you
// didn't have to type). In a git repo git does both, skipping what .gitignore skips; anywhere else a walk that
// steps around installed packages and build output, with caps so a search from your home folder stays quick.
// A newer search aborts this one (signal), which also stops its git. Paths come back relative to root.
const SKIP = new Set([...NOISE, 'Library', 'Applications', 'Movies', 'Music', 'Pictures', 'Photos Library.photoslibrary']);
const WALK_MAX = 20000, WALK_DEPTH = 6, TEXT_MAX = 512 * 1024, READ_BUDGET = 64 * 1024 * 1024;
const gitIn = (root, args, signal) => new Promise((res) => execFile('git', ['--no-optional-locks', '-C', root, ...args],
  { signal, timeout: 8000, maxBuffer: 64 << 20 }, (err, out) => res(!err ? out : err.code === 1 ? '' : null))); // grep exits 1 when nothing matches

async function walk(root, signal) {
  const out = [], queue = [['', 0]];
  while (queue.length && out.length < WALK_MAX && !signal?.aborted) {
    const [rel, depth] = queue.shift(); // breadth first: what's near the top comes first
    let entries;
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && depth < WALK_DEPTH) queue.push([path, depth + 1]); }
      else if (e.isFile()) out.push(path);
    }
  }
  return out;
}

// One line of a hit, cut to a readable length around the match.
function snippet(text, at, q) {
  const line = text.replace(/\t/g, '  ');
  if (line.length <= 160) return line.trim();
  const from = Math.max(0, at - 50);
  return (from ? '…' : '') + line.slice(from, from + 150).trim() + (from + 150 < line.length ? '…' : '');
}

export async function searchFiles(root, query, { names = 30, hits = 80, signal } = {}) {
  const q = String(query || '').trim(), low = q.toLowerCase();
  if (!q || !root) return { names: [], hits: [] };
  const listed = await gitIn(root, ['ls-files', '-co', '--exclude-standard', '-z'], signal);
  const git = listed != null;
  const files = git ? listed.split('\0').filter(Boolean) : await walk(root, signal);
  if (signal?.aborted) return null;

  // Names: the file's own name matching beats a folder on the way to it; starting with it beats containing it.
  const named = [];
  for (const path of files) {
    const at = path.toLowerCase().lastIndexOf(low);
    if (at < 0) continue;
    const cut = path.lastIndexOf('/') + 1, base = path.slice(cut).toLowerCase();
    named.push({ path, rank: base.startsWith(low) ? 0 : base.includes(low) ? 1 : 2 });
  }
  named.sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path));

  // Lines inside files.
  const found = [];
  if (git) {
    const out = await gitIn(root, ['grep', '-n', '-I', '-i', '-F', '--untracked', '--no-color', '-z', '-m', '3', '-e', q], signal);
    if (signal?.aborted) return null;
    for (const row of (out || '').split('\n')) {
      if (found.length >= hits) break;
      const [path, n, ...rest] = row.split('\0');
      if (!rest.length) continue;
      const text = rest.join('\0');
      found.push({ path, line: +n, text: snippet(text, text.toLowerCase().indexOf(low), q) });
    }
  } else {
    let budget = READ_BUDGET;
    for (const path of files) {
      if (found.length >= hits || budget <= 0 || signal?.aborted) break;
      const full = join(root, path);
      try {
        const { size } = await stat(full);
        if (size > TEXT_MAX) continue;
        budget -= size;
        const buf = await readFile(full);
        if (buf.subarray(0, 8192).includes(0)) continue; // binary
        const lines = buf.toString('utf8').split('\n');
        for (let i = 0, k = 0; i < lines.length && k < 3 && found.length < hits; i++) {
          const at = lines[i].toLowerCase().indexOf(low);
          if (at >= 0) { found.push({ path, line: i + 1, text: snippet(lines[i], at, q) }); k++; }
        }
      } catch {}
    }
  }
  if (signal?.aborted) return null;
  return { names: named.slice(0, names).map((x) => x.path), hits: found, git };
}

// "New folder" in the workspace picker: make <parent>/<name> and hand it back. A folder that's already there
// just opens; a name with a / (or . / ..) is refused, so it always lands right inside parent.
export function makeFolder(parent, name) {
  const n = String(name ?? '').trim();
  if (!n || n === '.' || n === '..' || n.includes('/') || n.includes('\0')) return { error: 'name' };
  const path = join(String(parent || ''), n);
  try {
    mkdirSync(path);
    return { path };
  } catch (e) {
    if (e.code !== 'EEXIST') return { error: 'failed' };
    try { return statSync(path).isDirectory() ? { path } : { error: 'exists-file' }; } catch { return { error: 'failed' }; }
  }
}
