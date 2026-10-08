// The side panel's Design view: a project's design system, read from its own files. CSS and SCSS variables
// (Tailwind v4's @theme too, and <style> blocks in HTML, Vue, Svelte and Astro files), a Tailwind v3 config's
// theme, and design-token JSON. Nothing in the project is ever run: configs are read as text, and only plain
// values (strings, numbers, objects, arrays) are taken from them. Main process only; check.mjs tests tokensFrom.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { projectFiles } from './files.mjs';

const MAX_FILES = 200, MAX_SIZE = 512 * 1024, MAX_TOKENS = 2000;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|storybook-static)\//;
const STYLE = /\.(css|scss|pcss|postcss)$/i, MARKUP = /\.(html?|vue|svelte|astro)$/i;
const TAILWIND = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/i;
const TOKENS_JSON = /(^|\/)(([\w.-]*[-_.])?tokens\.json|tokens\/.+\.json)$/i;
const THEME_JS = /(^|\/)(theme|tokens|design-tokens)(\.[\w-]+)?\.(js|cjs|mjs|ts)$/i;

// Which of a project's files can hold tokens, in the order they're read (styles first, the way they cascade).
export function tokenFiles(paths) {
  const ok = paths.filter((p) => !SKIP_DIR.test(p) && !/\.min\.css$|\.d\.ts$|\.(test|spec|stories)\./i.test(p) && !/(^|\/)(package(-lock)?|tsconfig|composer)\.json$/i.test(p));
  const rank = (p) => (TAILWIND.test(p) ? 1 : STYLE.test(p) ? 0 : TOKENS_JSON.test(p) ? 2 : THEME_JS.test(p) ? 3 : MARKUP.test(p) ? 4 : -1);
  return ok.filter((p) => rank(p) >= 0).sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b));
}

// --- CSS: custom properties (and SCSS $variables) with the selectors and at-rules around them ---------------
// A small scanner, not a full parser: it follows strings, comments, parentheses and braces, which is all it
// takes to find `--name: value;` and what it sits inside.
export function cssDecls(text, { scss = false } = {}) {
  const out = [], stack = [];
  let seg = '', segLine = 0, line = 1, paren = 0;
  const flush = () => {
    const m = /^(--[\w-]+|\$[\w-]+)\s*:([\s\S]*)$/.exec(seg.trim());
    if (m) out.push({ name: m[1], value: m[2].replace(/\s*!(default|important|global)\s*/g, ' ').replace(/\s+/g, ' ').trim(), line: segLine, ctx: [...stack] });
    seg = ''; segLine = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') line++;
    if (c === '/' && text[i + 1] === '*') { // a comment: skip it, keep counting lines
      const end = text.indexOf('*/', i + 2), stop = end < 0 ? text.length : end + 2;
      for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
      i = stop - 1; continue;
    }
    if (scss && paren === 0 && c === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i); i = (end < 0 ? text.length : end) - 1; continue; }
    if (!seg.trim() && !/\s/.test(c)) segLine = line;
    if (c === '"' || c === "'") { // a string: copy it whole
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; if (text[j] === '\n') line++; j++; }
      seg += text.slice(i, j + 1); i = j; continue;
    }
    if (c === '(') paren++;
    if (c === ')') paren = Math.max(0, paren - 1);
    if (paren === 0 && c === '{') { stack.push(seg.trim().replace(/\s+/g, ' ')); seg = ''; segLine = 0; continue; }
    if (paren === 0 && c === '}') { flush(); stack.pop(); continue; }
    if (paren === 0 && c === ';') { flush(); continue; }
    seg += c;
  }
  flush();
  return out;
}

// The theme a block's tokens belong to: 'base' for :root, html, :host and Tailwind's @theme, a name for a theme
// selector (.dark, [data-theme="ocean"], a prefers-color-scheme query), or null when it's a component's own
// variables (.button { --pad: 4px }) or inside something that isn't a theme (@font-face, a breakpoint).
const ROOTISH = /(:root|\bhtml\b|:host|\bbody\b)/g, IS_ROOTISH = /(:root|\bhtml\b|:host|\bbody\b)/;
const THEME_ATTR = /\[data-[\w-]*(?:theme|mode|scheme|appearance)[\w-]*\s*[~|^$*]?=\s*["']?([\w-]+)["']?\s*\]/i;
const THEME_CLASS = /\.((?:theme-)?[\w-]*(?:dark|light)[\w-]*|theme-[\w-]+)/i;
function selectorTheme(sel) {
  for (let s of sel.split(',')) {
    s = s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').replace(/:(?:where|is)\(([^()]*)\)/g, '$1').trim();
    let theme = null, m;
    if ((m = THEME_ATTR.exec(s))) { theme = m[1]; s = s.replace(m[0], ' '); }
    else if ((m = THEME_CLASS.exec(s))) { theme = m[1]; s = s.replace(m[0], ' '); }
    if (theme) theme = /dark/i.test(theme) ? 'dark' : /light/i.test(theme) ? 'light' : theme.replace(/^theme-/i, '');
    const rooted = IS_ROOTISH.test(s);
    const rest = s.replace(ROOTISH, ' ').replace(/[\s>+~*]/g, '');
    if (!rest && (rooted || theme)) return (theme || 'base').toLowerCase();
  }
  return null;
}
export function themeOf(ctx) {
  let theme = 'base';
  for (const p of ctx) {
    if (p.startsWith('@')) {
      const scheme = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(p);
      if (scheme) theme = scheme[1].toLowerCase();
      else if (!/^@(theme|layer|supports|media\s+(screen|all)\s*$)/i.test(p)) return null;
      continue;
    }
    const t = selectorTheme(p);
    if (t === null) return null;
    if (t !== 'base') theme = t;
  }
  return theme;
}

// --- Plain values out of JavaScript (a Tailwind config, a theme file), without running it --------------
// Reads an object/array/string/number literal at src[i]. Anything else (a function, a variable, a spread,
// a template with ${}) is skipped and left out: SKIP. Returns [value, next index].
const SKIP = Symbol('skip');
function literal(src, i) {
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith('//', i)) { i = src.indexOf('\n', i); if (i < 0) i = src.length; }
      else if (src.startsWith('/*', i)) { i = src.indexOf('*/', i); i = i < 0 ? src.length : i + 2; }
      else return;
    }
  };
  const skip = () => { // past this value: up to the , or closing bracket at this depth
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') { str(); continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (!depth) return; depth--; }
      else if (c === ',' && !depth) return;
      i++;
    }
  };
  const str = () => {
    const q = src[i++];
    let s = '', plain = true;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
      if (q === '`' && src[i] === '$' && src[i + 1] === '{') plain = false;
      s += src[i++];
    }
    i++;
    return plain ? s : SKIP;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') return str();
    if (c === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (src[i] === '}') { i++; return obj; }
        if (i >= src.length) return obj;
        const from = i;
        let key = null;
        if (src[i] === '"' || src[i] === "'") key = str();
        else { const m = /^[\w$-]+/.exec(src.slice(i, i + 200)); if (m) { key = m[0]; i += key.length; } }
        ws();
        if (key !== null && key !== SKIP && src[i] === ':') { i++; const v = value(); if (v !== SKIP) obj[key] = v; }
        else skip(); // ...spread, [computed], method() {}, shorthand
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== '}') { skip(); if (src[i] === ',') i++; }
        if (i === from) i++; // a stray ) or ]: step over it rather than loop
      }
    }
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (src[i] === ']') { i++; return arr; }
        if (i >= src.length) return arr;
        const v = value();
        if (v === SKIP) return (skipTo(']'), SKIP);
        arr.push(v);
        ws();
        if (src[i] === ',') i++;
      }
    }
    const m = /^-?\d*\.?\d+(?![\w.])/.exec(src.slice(i, i + 40));
    if (m) { i += m[0].length; ws(); if (/^[,}\]]/.test(src[i] || '}')) return Number(m[0]); }
    skip();
    return SKIP;
  };
  const skipTo = (close) => { let depth = 0; while (i < src.length) { const c = src[i]; if (c === '"' || c === "'" || c === '`') { str(); continue; } if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) { if (!depth && c === close) { i++; return; } depth--; } i++; } };
  const v = value();
  return [v, i];
}
// The first object literal after one of these openings (theme: {, export default {, = {, createTheme({).
function objectAfter(src, re) {
  const m = re.exec(src);
  if (!m) return null;
  const [v] = literal(src, m.index + m[0].length - 1);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
const lineAt = (src, i) => src.slice(0, Math.max(0, i)).split('\n').length;

// --- What kind of token a value is -------------------------------------------------------------------
const NAMED_COLORS = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey',
  'transparent', 'currentcolor', 'navy', 'teal', 'tomato', 'gold', 'silver', 'crimson', 'indigo', 'violet', 'coral', 'salmon']);
const COLOR_FN = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HSL_BARE = /^-?\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%(\s*\/\s*[\d.]+%?)?$/;
const RGB_BARE = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}(\s*\/\s*[\d.]+%?)?$/;
const COLORISH = /(colou?r|bg|background|fg|foreground|text|border|ring|accent|primary|secondary|muted|brand|surface|fill|stroke|ink)/i;
const LENGTH = /^-?(\d*\.?\d+)(px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|svh|dvh|lh)?$/;
const MATHY = /^(calc|clamp|min|max)\(/i;
const TIME = /^\d*\.?\d+m?s$/;
const EASING = /^(cubic-bezier|steps|linear)\(|^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i;
const GENERIC_FONT = /\b(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|-apple-system)\b/i;

// The CSS colour for a value, if it is one: as written, or wrapped when it's bare channels (shadcn's "222 84% 5%").
export function colorOf(v, name = '') {
  const s = String(v).trim();
  if (HEX.test(s) || COLOR_FN.test(s) || NAMED_COLORS.has(s.toLowerCase())) return s;
  if (HSL_BARE.test(s)) return `hsl(${s})`;
  if (RGB_BARE.test(s) && COLORISH.test(name)) return `rgb(${s})`;
  return null;
}
const isLength = (s) => LENGTH.test(s) || MATHY.test(s);
const looksLikeShadow = (s) => /(^|\s)-?\d*\.?\d+(px|rem|em)?\s+-?\d*\.?\d+(px|rem|em)?\s+/.test(s) && /(#|rgb|hsl|oklch|color-mix|black|white|transparent|var\()/i.test(s);

// kind: color | font | weight | leading | tracking | size | spacing | radius | shadow | duration | easing | other
export function classify(name, v) {
  const s = String(v).trim(), n = name.toLowerCase();
  if (!s) return 'other';
  if (colorOf(s, n)) return 'color';
  if (/shadow|elevation/.test(n) || looksLikeShadow(s)) return /blur|drop-shadow/.test(n) && isLength(s) ? 'other' : 'shadow';
  if (EASING.test(s) || (/eas(e|ing)|timing/.test(n) && !TIME.test(s))) return 'easing';
  if (TIME.test(s)) return 'duration';
  if (/radius|rounded|corner/.test(n)) return isLength(s) || /^\d/.test(s) ? 'radius' : 'other';
  if (/weight/.test(n) || (/(^|[-_.$])font/.test(n) && /^[1-9]00$/.test(s))) return 'weight';
  if (/leading|line-?height|(^|[-_.])lh([-_.]|$)/.test(n)) return 'leading';
  if (/tracking|letter-?spacing/.test(n)) return 'tracking';
  if (GENERIC_FONT.test(s) || (/font(-?family)?|family|typeface/.test(n) && !isLength(s) && !/^\d/.test(s))) return 'font';
  if (isLength(s) && /(^|[-_.$])(text|font-?size|fs|type|heading|h[1-6]|display|body|caption|title|label)([-_.]|$)/.test(n)) return 'size';
  if (isLength(s) && /space|spacing|gap|pad|margin|gutter|inset|stack|inline|size|(^|[-_.$])(s|sp)[-_]?\d/.test(n)) return 'spacing';
  return 'other';
}

// --- Putting it together -----------------------------------------------------------------------------
// files: [{ path, text }] in reading order. Returns { tokens, themes }:
//   tokens: [{ name, kind, use, src, file, line, raw, alias?, lh?, v: { base: css, dark?: css, … } }]
//   themes: ['base', 'dark', …], base first. A theme appears on a token only when its value differs there.
export function tokensFrom(files) {
  const defs = []; // { name, theme, value, file, line, src, kind?, use, lh? }
  const add = (d) => {
    const v = d.value == null ? '' : String(d.value).trim();
    if (v && v.length <= 300 && !/[;<>]/.test(v) && (!/[{}]/.test(v) || /^\{[\w.-]+\}$/.test(v))) defs.push({ ...d, value: v });
  };

  for (const { path, text } of files) {
    if (STYLE.test(path) || MARKUP.test(path)) {
      const scss = /\.scss$/i.test(path);
      const blocks = MARKUP.test(path) ? styleBlocks(text) : [{ css: text, line: 0 }];
      for (const b of blocks) for (const d of cssDecls(b.css, { scss: scss || /lang=["']?scss/.test(b.attrs || '') })) {
        const theme = d.name.startsWith('$') ? (d.ctx.length ? null : 'base') : d.ctx.length ? themeOf(d.ctx) : null;
        if (theme) add({ name: d.name, theme, value: d.value, file: path, line: d.line + b.line, src: d.name.startsWith('$') ? 'scss' : 'css',
          use: d.name.startsWith('$') ? d.name : `var(${d.name})` });
      }
    } else if (TAILWIND.test(path)) {
      for (const d of tailwindTokens(text)) add({ ...d, theme: 'base', file: path, src: 'tailwind' });
    } else if (/\.json$/i.test(path)) {
      let json; try { json = JSON.parse(text); } catch { continue; }
      for (const d of jsonTokens(json)) add({ ...d, theme: 'base', file: path, line: 0, src: 'json' });
    } else if (THEME_JS.test(path)) {
      const obj = objectAfter(text, /(export\s+default|module\.exports\s*=|=|createTheme\(|extendTheme\(|defineConfig\()\s*\{/);
      if (obj) for (const d of flatten(obj)) if (classify(d.name, d.value) !== 'other') add({ ...d, theme: 'base', file: path, line: 0, src: 'js', use: d.name });
    }
  }

  // A theme called "light" next to an unnamed base is usually the base under another name.
  const has = (theme, name) => defs.some((d) => d.theme === theme && d.name === name);
  for (const d of defs) if (d.theme === 'light' && !has('base', d.name)) d.theme = 'base';

  // The last definition wins, as in CSS; the first one keeps the token's place in the list.
  const byKey = new Map(), order = new Set();
  for (const d of defs) { order.add(d.name); byKey.set(`${d.theme}\0${d.name}`, d); }
  const themes = ['base', ...new Set(defs.map((d) => d.theme).filter((t) => t !== 'base'))];
  const raw = (name, theme) => byKey.get(`${theme}\0${name}`) || byKey.get(`base\0${name}`);
  const resolve = (value, theme, depth = 0) => {
    if (depth > 8) return value;
    let out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/g, (m, n, fb) => {
      const d = raw(n, theme);
      return d ? resolve(d.value, theme, depth + 1) : fb != null ? resolve(fb.trim(), theme, depth + 1) : m;
    });
    out = out.replace(/\$[\w-]+/g, (m) => { const d = raw(m, theme); return d ? resolve(d.value, theme, depth + 1) : m; });
    out = out.replace(/^\{([\w.-]+)\}$/, (m, n) => { const d = raw(n, theme); return d ? resolve(d.value, theme, depth + 1) : m; });
    return out;
  };

  const tokens = [];
  for (const name of [...order].slice(0, MAX_TOKENS)) {
    const base = raw(name, 'base') || themes.map((t) => byKey.get(`${t}\0${name}`)).find(Boolean);
    const v = {}; // a theme only where it differs from base (or there's no base: a dark-only token)
    for (const t of themes) {
      const d = byKey.get(`${t}\0${name}`) || byKey.get(`base\0${name}`);
      if (!d) continue;
      const r = resolve(d.value, t);
      if (t === 'base' || r !== v.base) v[t] = r;
    }
    const kind = base.kind || classify(name, v.base ?? Object.values(v)[0]);
    for (const t of Object.keys(v)) if (kind === 'color') v[t] = colorOf(v[t], name) || v[t];
    const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(base.value)?.[1] || /^(\$[\w-]+)$/.exec(base.value)?.[1] || /^\{([\w.-]+)\}$/.exec(base.value)?.[1];
    tokens.push({ name, kind, use: base.use, src: base.src, file: base.file, line: base.line, raw: base.value, v,
      ...(alias && { alias }), ...(base.lh && { lh: base.lh }) });
  }
  // Tailwind v4 pairs a size with its line height: --text-xl and --text-xl--line-height.
  const named = new Map(tokens.map((t) => [t.name, t]));
  for (const t of tokens) {
    const pair = t.kind === 'leading' && /^(.*)--line-height$/.exec(t.name);
    const size = pair && named.get(pair[1]);
    if (size?.kind === 'size') { size.lh ??= t.v.base; t.paired = true; }
  }
  return { tokens: tokens.filter((t) => !t.paired).map(({ paired, ...t }) => t), themes: themes.filter((t) => tokens.some((x) => t in x.v)) };
}

// <style> blocks in an HTML, Vue, Svelte or Astro file, with the line each starts on.
function styleBlocks(text) {
  const out = [], re = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(text))) out.push({ css: m[2], attrs: m[1], line: lineAt(text, m.index + m[0].indexOf('>') + 1) - 1 });
  return out;
}

// A Tailwind v3 config's theme (and theme.extend): colours, fonts, sizes, spacing, radius, shadows, motion.
const TW = { colors: 'color', textColor: 'color', backgroundColor: 'color', borderColor: 'color', fontFamily: 'font', fontSize: 'size',
  fontWeight: 'weight', lineHeight: 'leading', letterSpacing: 'tracking', spacing: 'spacing', borderRadius: 'radius', boxShadow: 'shadow',
  transitionDuration: 'duration', transitionTimingFunction: 'easing' };
// Named the way the classes are (text-lg, rounded-xl, shadow); colours by their own name (brand-500).
const TW_PREFIX = { font: 'font', size: 'text', weight: 'font', leading: 'leading', tracking: 'tracking', spacing: 'spacing', radius: 'rounded', shadow: 'shadow',
  duration: 'duration', easing: 'ease', color: '' };
export function tailwindTokens(src) {
  const at = /\btheme\s*:\s*\{/.exec(src);
  if (!at) return [];
  const [theme] = literal(src, at.index + at[0].length - 1);
  if (!theme || typeof theme !== 'object') return [];
  const line = lineAt(src, at.index), out = [];
  for (const scope of [theme, theme.extend || {}]) {
    for (const [key, kind] of Object.entries(TW)) {
      const group = scope[key];
      if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
      const walk = (obj, path) => {
        for (const [k, val] of Object.entries(obj)) {
          const p = k === 'DEFAULT' ? path : [...path, k];
          const id = p.join('-'), name = TW_PREFIX[kind] ? [TW_PREFIX[kind], id].filter(Boolean).join('-') : id; // rounded, rounded-lg
          if (kind === 'color' && val && typeof val === 'object' && !Array.isArray(val)) walk(val, p);
          else if (kind === 'font' && Array.isArray(val)) out.push({ name, kind, value: val.filter((x) => typeof x === 'string').map((f) => (/\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f)).join(', '), use: name, line });
          else if (kind === 'size' && Array.isArray(val)) {
            const lh = typeof val[1] === 'string' ? val[1] : val[1]?.lineHeight;
            if (typeof val[0] === 'string') out.push({ name, kind, value: val[0], use: name, line, ...(lh && { lh: String(lh) }) });
          } else if (typeof val === 'string' || typeof val === 'number') {
            if (kind === 'color' && !colorOf(val, 'color')) continue;
            out.push({ name, kind, value: String(val), use: name, line });
          }
        }
      };
      walk(group, []);
    }
  }
  return out;
}

// Design tokens in JSON: the W3C format ($value, $type) or Style Dictionary's (value, type). References like
// {color.brand.500} resolve to the token they point at.
const JSON_KIND = { color: 'color', dimension: null, fontFamily: 'font', fontWeight: 'weight', duration: 'duration', cubicBezier: 'easing',
  shadow: 'shadow', fontSize: 'size', lineHeight: 'leading', letterSpacing: 'tracking', borderRadius: 'radius', spacing: 'spacing', sizing: 'spacing' };
export function jsonTokens(json) {
  const out = [];
  const walk = (node, path, type) => {
    if (!node || typeof node !== 'object' || path.length > 8) return;
    const t = node.$type ?? node.type ?? type;
    const val = '$value' in node ? node.$value : 'value' in node ? node.value : undefined;
    if (val !== undefined && path.length) {
      const name = path.join('.');
      let value = val;
      if (Array.isArray(val) && val.length === 4 && val.every((x) => typeof x === 'number')) value = `cubic-bezier(${val.join(', ')})`;
      else if (t === 'shadow' && val && typeof val === 'object') value = [].concat(val).map(shadowText).filter(Boolean).join(', ');
      else if (Array.isArray(val) && t === 'fontFamily') value = val.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(', ');
      else if (val && typeof val === 'object') value = typeof val.value === 'number' && val.unit ? `${val.value}${val.unit}` : null; // { value: 4, unit: 'px' }
      if (value == null || typeof value === 'object') return;
      const kind = JSON_KIND[t] || undefined;
      out.push({ name, value: String(value), use: `{${name}}`, ...(kind && { kind }) });
      return;
    }
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('$') && k !== 'type' && k !== 'description') walk(v, [...path, k], t);
  };
  walk(json, [], undefined);
  return out; // a token without a known $type is classified once its references resolve (tokensFrom)
}
function shadowText(s) {
  if (!s || typeof s !== 'object') return typeof s === 'string' ? s : null;
  const len = (x) => (typeof x === 'number' ? `${x}px` : x && typeof x === 'object' ? `${x.value}${x.unit || ''}` : x ?? '0');
  return `${s.inset ? 'inset ' : ''}${len(s.offsetX ?? s.x)} ${len(s.offsetY ?? s.y)} ${len(s.blur)} ${len(s.spread)} ${s.color ?? ''}`.trim();
}
// Every plain leaf of a theme object, named by its path (colors.brand.500).
function flatten(obj, path = [], out = []) {
  if (path.length > 6 || out.length > MAX_TOKENS) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, [...path, k], out);
    else if (typeof v === 'string' || typeof v === 'number') out.push({ name: [...path, k].join('.'), value: String(v) });
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out.push({ name: [...path, k].join('.'), value: v.join(', ') });
  }
  return out;
}

// --- Reading a project -------------------------------------------------------------------------------
// The last scan of each folder, kept so asking again (the panel checks every few seconds while it's open)
// only re-reads when a file changed. at: when what it found last changed.
const cache = new Map(); // root -> { stamp, result }
export async function scanDesign(root, { signal } = {}) {
  const all = await projectFiles(root, signal);
  if (!all) return null;
  const paths = tokenFiles(all).slice(0, MAX_FILES * 2);
  const files = [], stamps = [];
  for (const p of paths) {
    if (files.length >= MAX_FILES || signal?.aborted) break;
    try {
      const s = await stat(join(root, p));
      if (!s.isFile() || s.size > MAX_SIZE) continue;
      stamps.push(`${p}:${s.mtimeMs}:${s.size}`);
      files.push(p);
    } catch {}
  }
  const stamp = stamps.join('\n'), hit = cache.get(root);
  if (hit && hit.stamp === stamp) return hit.result;
  const texts = [];
  for (const p of files) {
    let text;
    try { text = await readFile(join(root, p), 'utf8'); } catch { continue; }
    // Only files that can hold tokens are worth parsing (a component's CSS often has none).
    if (STYLE.test(p) || MARKUP.test(p) ? /--[\w-]+\s*:|\$[\w-]+\s*:/.test(text) : true) texts.push({ path: p, text });
  }
  const { tokens, themes } = tokensFrom(texts);
  const prev = hit?.result;
  const same = prev && JSON.stringify(prev.tokens) === JSON.stringify(tokens);
  const result = { tokens, themes, files: [...new Set(tokens.map((t) => t.file))], at: same ? prev.at : Date.now() };
  cache.set(root, { stamp, result });
  return result;
}
