// The sidebar's file tree and what the preview panel shows. Main process only; check.mjs tests it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
