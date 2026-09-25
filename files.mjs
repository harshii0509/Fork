// The sidebar's file tree and what the preview panel shows. Main process only; check.mjs tests it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { marked } from 'marked';
import { bundledLanguages, createCssVariablesTheme, createHighlighter, createOnigurumaEngine } from 'shiki';

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
const MAX_COLOUR = 150 * 1024; // colouring takes ~0.2s per 30 KB; past this, plain text
// Shiki knows most extensions by name (ts, tsx, md, yml…); these it doesn't.
const LANG = { htm: 'html', svg: 'xml', env: 'dotenv' };
const NAMED = { dockerfile: 'dockerfile', makefile: 'makefile', gemfile: 'ruby', podfile: 'ruby' };
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Shiki reads code with VS Code's grammars. Its colours are CSS variables, so the app's theme fills them in.
let shiki;
const highlighter = () => (shiki ??= createHighlighter({
  themes: [createCssVariablesTheme({ name: 'app', variablePrefix: '--code-', fontStyle: true })],
  langs: [], engine: createOnigurumaEngine(import('shiki/wasm')),
}));
async function colour(text, lang) {
  const h = await highlighter();
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
  // Just the lines: the panel draws its own <pre> with a line-number gutter.
  return h.codeToHtml(text, { lang, theme: 'app' }).replace(/^<pre[^>]*><code>|<\/code><\/pre>$/g, '');
}

// { kind: image | video | markdown | code | html | other | missing, size, html?, lines?, why? }
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
  const lang = LANG[ext] || NAMED[basename(path).toLowerCase()] || (ext in bundledLanguages && ext);
  const html = lang && bundledLanguages[lang] && text.length <= MAX_COLOUR ? await colour(text, lang) : escape(text);
  return { kind: ext === 'html' || ext === 'htm' ? 'html' : 'code', size, html,
    lines: text.replace(/\n$/, '').split('\n').length };
}

// The code editor to hand real edits to: the first one installed.
const EDITORS = [['Cursor', 'Cursor'], ['Visual Studio Code', 'VS Code'], ['Zed', 'Zed'], ['Windsurf', 'Windsurf']];
export function findEditor() {
  const dirs = ['/Applications', join(homedir(), 'Applications')];
  const hit = EDITORS.find(([app]) => dirs.some((d) => existsSync(join(d, `${app}.app`))));
  return hit ? { app: hit[0], label: hit[1] } : null;
}
