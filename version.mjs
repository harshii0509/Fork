// Version numbers: X.Y.Z, or X.Y.Z-beta.N for a beta. A beta comes before its final release,
// so 0.3.0-beta.1 < 0.3.0-beta.2 < 0.3.0. Used by the update pill (main.js) and npm run release.

export function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(v).trim());
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], beta: m[4] === undefined ? null : +m[4] };
}

// Is a newer than b? Anything unreadable counts as not newer, so a bad tag never shows the pill.
export function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i];
  if (x.beta === null) return y.beta !== null; // final beats its betas
  if (y.beta === null) return false;
  return x.beta > y.beta;
}

// The next version for npm run release: patch | minor | major | beta.
// beta on a final version starts the next minor's betas (0.2.1 → 0.3.0-beta.1); on a beta it counts up.
export function bump(v, kind) {
  const p = parse(v);
  if (!p) throw new Error(`Can't read the version "${v}".`);
  const [M, m, pa] = p.core;
  if (kind === 'beta') return p.beta === null ? `${M}.${m + 1}.0-beta.1` : `${M}.${m}.${pa}-beta.${p.beta + 1}`;
  if (p.beta !== null) return `${M}.${m}.${pa}`; // finishing a beta: 0.3.0-beta.2 → 0.3.0
  if (kind === 'patch') return `${M}.${m}.${pa + 1}`;
  if (kind === 'minor') return `${M}.${m + 1}.0`;
  if (kind === 'major') return `${M + 1}.0.0`;
  throw new Error(`Unknown release kind "${kind}". Use patch, minor, major or beta.`);
}
