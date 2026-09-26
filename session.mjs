// Reopening Fork the way you left it. main.js saves each window's tabs, splits, folders and screens
// to session.json (on this Mac only) and reads them back at launch. clean() checks what's read, so a
// damaged or old file can never stop Fork from starting: at worst it starts fresh.
//
// { v: 1, enabled, savedAt, windows: [{ bounds, tabIx, side: { hidden, width }, tabs: [{ active, root }] }] }
// root is a split { dir: 'row'|'col', ratio, a, b } or a pane { cwd, claude?, screen? }.

export const VERSION = 1;
export const MAX_SCREEN = 200_000; // characters of saved output per pane
const MAX_DEPTH = 12;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => typeof v === 'number' && Number.isFinite(v);

// Keep the end of a long screen, cut at a line start so no colour code is split in half.
export function trimScreen(s) {
  if (typeof s !== 'string' || !s) return undefined;
  if (s.length <= MAX_SCREEN) return s;
  const cut = s.indexOf('\n', s.length - MAX_SCREEN);
  return cut < 0 ? undefined : s.slice(cut + 1);
}

function node(n, ctx, depth = 0) {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH) return null;
  if (n.dir === 'row' || n.dir === 'col') {
    const a = node(n.a, ctx, depth + 1), b = node(n.b, ctx, depth + 1);
    if (!a || !b) return a || b; // a broken half: keep the other one
    return { dir: n.dir, ratio: clamp(num(n.ratio) ? n.ratio : 0.5, 0.15, 0.85), a, b };
  }
  if (typeof n.cwd !== 'string') return null;
  // A folder that's gone (deleted, unplugged drive) would stop the shell starting: use home instead.
  const pane = { cwd: n.cwd && ctx.exists(n.cwd) ? n.cwd : ctx.home };
  if (n.claude === true) pane.claude = true;
  const screen = trimScreen(n.screen);
  if (screen) pane.screen = screen;
  return pane;
}

export const countPanes = (n) => (n.dir ? countPanes(n.a) + countPanes(n.b) : 1);

function win(w, ctx) {
  if (!w || typeof w !== 'object' || !Array.isArray(w.tabs)) return null;
  const tabs = w.tabs.map((t) => {
    const root = node(t?.root, ctx);
    if (!root) return null;
    const n = countPanes(root);
    return { root, active: Number.isInteger(t.active) ? clamp(t.active, 0, n - 1) : 0 };
  }).filter(Boolean);
  if (!tabs.length) return null;
  const b = w.bounds;
  const bounds = b && [b.x, b.y, b.width, b.height].every(num) && b.width >= 400 && b.height >= 300
    ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : undefined;
  const side = { hidden: w.side?.hidden === true };
  if (num(w.side?.width)) side.width = clamp(Math.round(w.side.width), 180, 420);
  return { bounds, tabIx: Number.isInteger(w.tabIx) ? clamp(w.tabIx, 0, tabs.length - 1) : 0, side, tabs };
}

// What's safe to restore. Anything unreadable becomes "nothing to restore", never an error.
export function clean(saved, { exists, home }) {
  if (!saved || typeof saved !== 'object' || saved.v !== VERSION) return { enabled: saved?.enabled !== false, windows: [] };
  const ctx = { exists, home };
  const windows = (Array.isArray(saved.windows) ? saved.windows : []).map((w) => win(w, ctx)).filter(Boolean);
  return { enabled: saved.enabled !== false, savedAt: num(saved.savedAt) ? saved.savedAt : undefined, windows };
}
