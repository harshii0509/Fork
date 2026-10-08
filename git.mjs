// A workspace's line in the sidebar: its branch and what's changed, from `git status --porcelain --branch`
// and `git diff HEAD --shortstat` (main.js runs them). New files count as changed files; their lines don't.
export function gitInfo(status, shortstat) {
  const lines = status.split('\n').filter(Boolean);
  let branch = lines[0]?.startsWith('## ') ? lines.shift().slice(3).split('...')[0] : '';
  for (const pre of ['No commits yet on ', 'Initial commit on ']) if (branch.startsWith(pre)) branch = branch.slice(pre.length);
  if (branch.startsWith('HEAD (no branch)')) branch = 'no branch';
  const n = (re) => Number(shortstat?.match(re)?.[1] || 0);
  return { branch, files: lines.length, add: n(/(\d+) insertions?\(/), del: n(/(\d+) deletions?\(/) };
}

// The Files tree's git badges, from `git status --porcelain -z --untracked-files=all` (paths from the repo's top)
// and `git rev-parse --show-prefix` (where the tree's folder sits in the repo). Paths come back relative to that
// folder; anything outside it, or hidden (a dot name anywhere), is left out like the tree leaves it out.
export function gitFiles(status, prefix = '') {
  const parts = status.split('\0'), out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const xy = p.slice(0, 2), path = p.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the old name follows
    const s = xy === '??' ? 'untracked' : xy === '!!' ? 'ignored' : xy.includes('D') ? 'deleted'
      : xy[0] === 'R' ? 'renamed' : xy[0] === 'A' ? 'added' : 'modified';
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    if (rel && !rel.split('/').some((seg) => seg.startsWith('.'))) out.push({ path: rel, status: s });
  }
  return out;
}
