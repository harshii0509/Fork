// What can I do here? Plain-English actions that map to real commands.
// `run: true` = looking/moving, runs instantly. Otherwise the command is typed and
// the person presses Enter themselves (they stay in control and learn the command).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const has = (dir, f) => existsSync(join(dir, f));
export const scripts = (dir) => {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts || {}; }
  catch { return {}; }
};
const isEmpty = (dir) => {
  try { return readdirSync(dir).filter((f) => !f.startsWith('.')).length === 0; }
  catch { return false; }
};
// Which package manager this project uses, from its lockfile.
export const pm = (dir) =>
  has(dir, 'pnpm-lock.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn'
    : has(dir, 'bun.lock') || has(dir, 'bun.lockb') ? 'bun' : 'npm';

const RULES = [
  { when: isEmpty, label: 'Get a project from GitHub', cmd: () => 'git clone ',
    why: 'Downloads a project. Paste its GitHub link after the command.' },
  { when: (d) => has(d, 'package.json') && !has(d, 'node_modules'), label: 'Install what it needs',
    cmd: (d) => `${pm(d)} install`, why: 'Downloads the code this project depends on. Needed once, before starting it.' },
  { when: (d) => has(d, 'node_modules') && scripts(d).dev, label: 'Start the app',
    cmd: (d) => `${pm(d)} run dev`, why: 'Runs the app on your computer. Press Ctrl+C to stop it.' },
  { when: (d) => has(d, '.git'), label: 'See what changed', cmd: () => 'git status', run: true,
    why: 'Lists the files changed since the last save point (commit).' },
  { when: (d) => has(d, '.git'), label: 'Get latest', cmd: () => 'git pull',
    why: "Downloads your team's newest changes into this folder." },
  { when: (d) => has(d, '.git') || has(d, 'CLAUDE.md'), label: 'Ask Claude', cmd: () => 'claude',
    why: 'Opens Claude Code to build or change things with you.' },
  { when: () => true, label: 'Show in Finder', cmd: () => 'open .', run: true, why: 'Opens this folder in Finder.' },
  { when: (d) => d !== '/', label: 'Go up a folder', cmd: () => 'cd ..', run: true,
    why: 'Moves to the folder that contains this one.' },
];

export const suggest = (dir) =>
  RULES.filter((r) => r.when(dir)).map((r) => ({ label: r.label, cmd: r.cmd(dir), why: r.why, run: !!r.run }));

// Cmd+K palette: searchable by plain-English name. Trailing space = "fill in the rest".
export const PALETTE = [
  ['Go up a folder', 'cd ..', 'Moves to the folder that contains this one.', true],
  ['Go to my home folder', 'cd ~', 'Your personal folder, where Desktop and Documents live.', true],
  ['Go to Desktop', 'cd ~/Desktop', 'Moves into your Desktop folder.', true],
  ['Where am I?', 'pwd', 'Prints the full path of the current folder.', true],
  ['List files here', 'ls', 'Shows what is in this folder.', true],
  ['List files, including hidden ones', 'ls -a', 'Also shows files starting with a dot, like .env.', true],
  ['Clear the screen', 'clear', 'Wipes the screen. Nothing is deleted.', true],
  ['Show in Finder', 'open .', 'Opens this folder in Finder.', true],
  ['Open a file', 'open ', 'Opens a file in its usual app. Type the file name after the command.'],
  ['Make a new folder', 'mkdir ', 'Creates a folder. Type its name after the command.'],
  ['Make an empty file', 'touch ', 'Creates an empty file. Type its name after the command.'],
  ['Delete (moves to Trash)', 'rm ', 'Moves a file or folder to the Trash. You can get it back.'],
  ['Copy a file', 'cp ', 'Copy: type the file, then where the copy should go.'],
  ['Move or rename a file', 'mv ', 'Type the file, then its new name or folder.'],
  ['Find a file by name', 'find . -name "*name*"', 'Searches this folder and everything inside it. Replace name.'],
  ['Search for text inside files', 'grep -rn "text" . --exclude-dir=node_modules', 'Finds every line containing the text. Replace text.'],
  ['Stop what is running', '\x03', 'Same as pressing Ctrl+C. Stops the current command.', true],
  ['Install what it needs', 'npm install', 'Downloads the code this project depends on.'],
  ['Start the app', 'npm run dev', 'Runs the app on your computer. Press Ctrl+C to stop it.'],
  ['See what changed', 'git status', 'Lists the files changed since the last save point (commit).', true],
  ['See changes line by line', 'git diff', 'Shows exactly which lines changed. Press q to exit.', true],
  ['Get latest from the team', 'git pull', "Downloads your team's newest changes."],
  ['Save a checkpoint (commit)', 'git add -A && git commit -m "describe your change"', 'Saves all changes as a checkpoint you can go back to. Edit the message first.'],
  ['Upload my changes', 'git push', 'Sends your checkpoints to GitHub so the team can see them.'],
  ['Undo my changes to a file', 'git restore ', 'Puts a file back to its last checkpoint. Type the file name.'],
  ['Start a new branch', 'git switch -c ', 'A separate copy of the project to try things safely. Type a name.'],
  ['Switch branch', 'git switch ', 'Moves to another branch. Type its name.'],
  ['Get a project from GitHub', 'git clone ', 'Downloads a project. Paste its GitHub link after the command.'],
  ['Ask Claude', 'claude', 'Opens Claude Code to build or change things with you.'],
  ['Which Node version do I have?', 'node -v', 'Prints the installed Node.js version.', true],
].map(([label, cmd, why, run]) => ({ label, cmd, why, run: !!run }));
