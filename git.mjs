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
