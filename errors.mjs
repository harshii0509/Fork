// "What went wrong?" without AI: the errors people new to the terminal hit again and again, each with a
// plain-English explanation and, where there is one, a fix Fork types in (never runs). Instant, offline,
// and in Fork's own words. Anything not here goes to "This one's unusual. Want Claude to take a look?"
//
// Adding one is like adding an FAQ entry:
//   { id, match, text(m, ctx), fix(m, ctx)?, samples: [...] }
// - id: short and stable, it's what analytics counts (never the error text itself).
// - match: a regex over what the failed command printed. The first entry that matches wins, so put
//   specific ones before general ones.
// - text: one or two short sentences, calm, no jargon. Say what happened, then what to do.
// - fix: one command, or nothing. It's typed for the person to read and run, so keep it safe.
// - samples: real output this entry must catch. npm run check makes sure each one lands here.
//   A sample can be { out, ctx, fix } to also check the fix for a given folder.
//
// ctx (from main.js, for the folder the command ran in):
//   { pm: 'npm'|'pnpm'|'yarn'|'bun', scripts: [names], hasNodeModules, nvmrc, hasBrew, hasGh }

const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`); // shell-quote only if needed
const run = (ctx, s) => `${ctx.pm} run ${s}`;
const add = (ctx, pkg) => (ctx.pm === 'npm' ? `npm install ${pkg}` : `${ctx.pm} add ${pkg}`);
const pkgRoot = (name) => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);
const first = (m) => m.slice(1).find((x) => x !== undefined);
const HOMEBREW = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
const PRIVACY = 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"';

// "command not found" for tools people are usually told to use. Anything else gets the general answer.
const MISSING = {
  node: (ctx) => ctx.hasBrew
    ? ['Node isn\'t installed. It\'s what runs most web projects, and Homebrew can install it.', 'brew install node']
    : ['Node isn\'t installed. It\'s what runs most web projects: download it from nodejs.org, then open a new tab.'],
  brew: () => ['Homebrew isn\'t installed. It\'s the usual way to install developer tools on a Mac, and this is its official installer.', HOMEBREW],
  git: () => ['Git comes with Apple\'s developer tools, and they aren\'t installed yet. This opens Apple\'s installer.', 'xcode-select --install'],
  python: () => ['On a Mac, Python is called python3. Run the same thing again with python3 instead.'],
  pip: () => ['On a Mac, pip is called pip3. Run the same thing again with pip3 instead.'],
  pnpm: () => ['pnpm isn\'t installed. It\'s another way to install a project\'s packages, and npm can install it.', 'npm install -g pnpm'],
  yarn: () => ['Yarn isn\'t installed. It\'s another way to install a project\'s packages, and npm can install it.', 'npm install -g yarn'],
  bun: () => ['Bun isn\'t installed. This is its official installer.', 'curl -fsSL https://bun.sh/install | bash'],
  code: () => ['VS Code\'s "code" command isn\'t set up. In VS Code, press ⌘⇧P and choose "Shell Command: Install \'code\' command in PATH".'],
  claude: () => ['Claude Code isn\'t installed. This is its official installer.', 'curl -fsSL https://claude.ai/install.sh | bash'],
  codex: (ctx) => ['Codex isn\'t installed yet.', ctx.hasBrew ? 'brew install --cask codex' : 'npm install -g @openai/codex'],
  gh: (ctx) => ['GitHub\'s own tool isn\'t installed.', ...(ctx.hasBrew ? ['brew install gh'] : [])],
};
MISSING.npm = MISSING.npx = MISSING.node;
MISSING.python2 = MISSING.python;

export const ERRORS = [
  // --- npm and Node ---------------------------------------------------------------------------------
  {
    id: 'npm-missing-script',
    match: /Missing script:\s*"?([\w:.-]+)"?|error Command "([\w:.-]+)" not found|Script not found "([\w:.-]+)"/,
    text: (m, ctx) => {
      const s = first(m), that = s ? `a "${s}" script` : 'that script';
      return ctx.scripts.length
        ? `This project doesn't have ${that}. The ones it has: ${ctx.scripts.join(', ')}.`
        : `This project doesn't have ${that}, or any scripts at all.`;
    },
    fix: (m, ctx) => {
      const pick = ['dev', 'start', 'serve', 'preview'].find((s) => ctx.scripts.includes(s) && s !== first(m));
      return pick ? run(ctx, pick) : null;
    },
    samples: [
      { out: 'npm ERR! Missing script: "dev"\nnpm ERR!\nnpm ERR! To see a list of scripts, run:\nnpm ERR!   npm run', ctx: { scripts: ['build', 'start'] }, fix: 'npm run start' },
      'npm error Missing script: "dev"',
      { out: ' ERR_PNPM_NO_SCRIPT  Missing script: dev', ctx: { pm: 'pnpm', scripts: ['preview'] }, fix: 'pnpm run preview' },
      'error Command "dev" not found.',
      'error: Script not found "dev"',
    ],
  },
  {
    id: 'npm-no-package-json',
    match: /ENOENT[\s\S]{0,300}package\.json|Could not read package\.json|no package\.json/i,
    text: () => 'This folder isn\'t a project: there\'s no package.json here. Move into your project\'s folder first.',
    fix: () => 'ls',
    samples: [
      'npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /Users/me/Desktop/package.json\nnpm ERR! errno -2\nnpm ERR! enoent ENOENT: no such file or directory, open \'/Users/me/Desktop/package.json\'',
      'npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open \'/Users/me/package.json\'',
    ],
  },
  {
    id: 'deps-not-installed',
    match: /\bsh: (?:\d+: )?([\w.@/-]+): (?:command )?not found/,
    text: (m) => `${m[1] ? `"${m[1]}" is` : 'That\'s'} one of this project's tools, and the project's packages aren't installed yet.`,
    fix: (m, ctx) => `${ctx.pm} install`,
    samples: [
      '> my-site@0.1.0 dev\n> next dev\n\nsh: next: command not found',
      { out: '> vite\n\nsh: vite: command not found', ctx: { pm: 'pnpm' }, fix: 'pnpm install' },
    ],
  },
  {
    id: 'module-not-found',
    match: /Cannot find module '([^']+)'|Module not found: (?:Error: )?Can't resolve '([^']+)'|Cannot find package '([^']+)'/,
    text: (m, ctx) => {
      const name = first(m);
      if (!name) return ctx.hasNodeModules ? 'Part of this project is looking for a package or file that isn\'t there.' : 'This project\'s packages aren\'t installed yet.';
      if (/^[./]/.test(name)) return `Something imports a file that isn't there: "${name}". Check the file's name and where it is.`;
      return ctx.hasNodeModules ? `The package "${pkgRoot(name)}" isn't installed in this project.` : 'This project\'s packages aren\'t installed yet.';
    },
    fix: (m, ctx) => {
      const name = first(m);
      if (!name) return ctx.hasNodeModules ? null : `${ctx.pm} install`;
      if (/^[./]/.test(name)) return null;
      return ctx.hasNodeModules ? add(ctx, pkgRoot(name)) : `${ctx.pm} install`;
    },
    samples: [
      { out: "Error: Cannot find module 'express'\nRequire stack:\n- /Users/me/app/server.js", ctx: { hasNodeModules: true }, fix: 'npm install express' },
      { out: "Module not found: Can't resolve '@radix-ui/react-dialog/dist'", ctx: { hasNodeModules: false, pm: 'pnpm' }, fix: 'pnpm install' },
      { out: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from /Users/me/app/index.js", ctx: { hasNodeModules: true, pm: 'yarn' }, fix: 'yarn add zod' },
      { out: "Module not found: Error: Can't resolve './components/Hero'", fix: null },
    ],
  },
  {
    id: 'port-in-use',
    match: /EADDRINUSE[^\n]*?:(\d{2,5})\b|port (\d{2,5}) is (?:already )?in use|address already in use(?:[^\n]*?:(\d{2,5})\b)?/i,
    text: (m) => {
      const port = first(m);
      return port
        ? `Another app is already using port ${port}, often an earlier copy of this one still running in another tab. Stop it there with Ctrl+C, or see what's using it:`
        : 'Another app is already using that port, often an earlier copy of this one still running in another tab. Stop it there with Ctrl+C.';
    },
    fix: (m) => (first(m) ? `lsof -i :${first(m)}` : null),
    samples: [
      { out: 'Error: listen EADDRINUSE: address already in use :::3000\n    at Server.setupListenHandle', fix: 'lsof -i :3000' },
      { out: 'Port 5173 is in use, trying another one...\nerror when starting dev server:\nError: Port 5173 is already in use', fix: 'lsof -i :5173' },
      'OSError: [Errno 48] Address already in use',
    ],
  },
  {
    id: 'npm-eresolve',
    match: /ERESOLVE/,
    text: () => 'Two of this project\'s packages want different versions of the same thing. Installing with "legacy peer deps" usually gets past it.',
    fix: (m, ctx) => (ctx.pm === 'npm' ? 'npm install --legacy-peer-deps' : null),
    samples: [{ out: 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree', fix: 'npm install --legacy-peer-deps' }],
  },
  {
    id: 'node-version',
    match: /Unsupported engine|The engine "node" is incompatible|Node\.js version (?:>=?\s*)?v?\d[\d.]* is required|requires (?:a )?Node(?:\.js)? (?:version )?[>=^~v\d]/,
    text: () => 'This project needs a different version of Node than the one on your Mac.',
    fix: (m, ctx) => (ctx.nvmrc ? 'nvm install' : 'node -v'),
    samples: [
      { out: 'You are using Node.js 16.20.0. For Next.js, Node.js version >= v18.17.0 is required.', ctx: { nvmrc: true }, fix: 'nvm install' },
      { out: 'error my-app@1.0.0: The engine "node" is incompatible with this module. Expected version ">=20". Got "18.19.0"', fix: 'node -v' },
      'npm WARN EBADENGINE Unsupported engine {',
    ],
  },
  {
    id: 'npm-e404',
    match: /npm (?:ERR!|error) (?:code )?E404|is not in this registry|404 Not Found - GET https:\/\/registry/,
    text: () => 'There\'s no package with that name. Check the spelling.',
    samples: ["npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/reactt - Not found\nnpm ERR! 404  'reactt@*' is not in this registry."],
  },
  {
    id: 'npm-eacces',
    match: /npm (?:ERR!|error) code EACCES|EACCES: permission denied[^\n]*(?:\/usr\/local|node_modules)/,
    text: () => 'npm tried to install into a folder your account can\'t change. Installing "globally" is rarely needed: try running the tool with npx instead, and avoid sudo.',
    samples: ["npm ERR! code EACCES\nnpm ERR! syscall mkdir\nnpm ERR! path /usr/local/lib/node_modules/typescript\nnpm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/typescript'"],
  },
  {
    id: 'offline',
    match: /\bENOTFOUND\b|\bgetaddrinfo\b|Could not resolve host|EAI_AGAIN|[Nn]etwork is unreachable|Failed to connect to [\w.-]+ port/, // exact case: ModuleNotFoundError isn't ENOTFOUND
    text: () => 'Fork can\'t reach the internet from here. Check your Wi-Fi, then try again.',
    samples: [
      'npm ERR! code ENOTFOUND\nnpm ERR! syscall getaddrinfo\nnpm ERR! errno ENOTFOUND',
      "fatal: unable to access 'https://github.com/me/site.git/': Could not resolve host: github.com",
    ],
  },

  // --- Git --------------------------------------------------------------------------------------------
  {
    id: 'git-not-a-repo',
    match: /not a git repository/,
    text: () => 'This folder isn\'t tracked by Git. Move into your project\'s folder, or start tracking this one:',
    fix: () => 'git init',
    samples: ['fatal: not a git repository (or any of the parent directories): .git'],
  },
  {
    id: 'git-conflict',
    match: /CONFLICT \(|Automatic merge failed|fix conflicts and then commit|resolve your current index first|you have unmerged files/i,
    text: () => 'Two versions of the same lines clashed, so Git wants you to pick. In the files it lists, keep what you want between the <<<<<<< and >>>>>>> marks, then save a checkpoint.',
    fix: () => 'git status',
    samples: [
      'Auto-merging src/App.tsx\nCONFLICT (content): Merge conflict in src/App.tsx\nAutomatic merge failed; fix conflicts and then commit the result.',
      'error: Pulling is not possible because you have unmerged files.',
    ],
  },
  {
    id: 'git-would-overwrite',
    match: /would be overwritten by (?:merge|checkout)/,
    text: () => 'You have changes that this would overwrite. Put them aside first; "git stash pop" brings them back afterwards.',
    fix: () => 'git stash',
    samples: ['error: Your local changes to the following files would be overwritten by merge:\n\tsrc/App.tsx\nPlease commit your changes or stash them before you merge.\nAborting'],
  },
  {
    id: 'git-push-rejected',
    match: /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)|Updates were rejected because/,
    text: () => 'GitHub has changes you don\'t have yet. Get them first, then push again.',
    fix: () => 'git pull',
    samples: [' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to \'github.com:me/site.git\'\nhint: Updates were rejected because the remote contains work that you do not have locally.'],
  },
  {
    id: 'git-no-upstream',
    match: /The current branch (\S+) has no upstream branch/,
    text: () => 'This branch isn\'t on GitHub yet. The first time, push it like this:',
    fix: (m) => (m[1] ? `git push --set-upstream origin ${m[1]}` : 'git push --set-upstream origin HEAD'),
    samples: [{ out: 'fatal: The current branch new-hero has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin new-hero', fix: 'git push --set-upstream origin new-hero' }],
  },
  {
    id: 'git-nothing-to-commit',
    match: /nothing to commit, working tree clean|nothing to commit \(|nothing added to commit but untracked/,
    text: () => 'Nothing to save: there are no changes since your last checkpoint.',
    samples: ['On branch main\nYour branch is up to date with \'origin/main\'.\n\nnothing to commit, working tree clean'],
  },
  {
    id: 'git-nothing-added',
    match: /no changes added to commit/,
    text: () => 'Git only saves the changes you\'ve added. Add them all, then commit again.',
    fix: () => 'git add .',
    samples: ['Changes not staged for commit:\n\tmodified:   index.html\n\nno changes added to commit (use "git add" and/or "git commit -a")'],
  },
  {
    id: 'git-identity',
    match: /Please tell me who you are|Author identity unknown/,
    text: () => 'Git needs your name and email once, to label your checkpoints. Put your name in this, then do the same with user.email.',
    fix: () => 'git config --global user.name "Your Name"',
    samples: ['Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"'],
  },
  {
    id: 'git-auth',
    match: /Permission denied \(publickey\)|Authentication failed for|could not read Username for|Invalid username or (?:password|token)|Support for password authentication was removed/,
    text: (m, ctx) => (ctx.hasGh
      ? 'GitHub doesn\'t recognise this Mac yet. Sign in with GitHub\'s own tool:'
      : 'GitHub doesn\'t recognise this Mac yet. The easiest way to sign in is GitHub\'s own tool: install it, then run gh auth login.'),
    fix: (m, ctx) => (ctx.hasGh ? 'gh auth login' : ctx.hasBrew ? 'brew install gh' : null),
    samples: [
      { out: 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', ctx: { hasGh: true }, fix: 'gh auth login' },
      { out: "remote: Support for password authentication was removed on August 13, 2021.\nfatal: Authentication failed for 'https://github.com/me/site.git/'", ctx: { hasBrew: true }, fix: 'brew install gh' },
    ],
  },
  {
    id: 'git-repo-not-found',
    match: /Repository not found|repository '[^']*' not found|does not appear to be a git repository/,
    text: () => 'GitHub can\'t find that project. Check the link; if it\'s private, you need access and to be signed in.',
    samples: ["remote: Repository not found.\nfatal: repository 'https://github.com/me/sitee.git/' not found"],
  },
  {
    id: 'git-pathspec',
    match: /pathspec '([^']+)' did not match any file/,
    text: (m) => `Git doesn't know ${m[1] ? `anything called "${m[1]}"` : 'that name'}. Check the spelling. To see your branches:`,
    fix: () => 'git branch -a',
    samples: ["error: pathspec 'feature/hero' did not match any file(s) known to git"],
  },
  {
    id: 'git-clone-exists',
    match: /destination path '([^']+)' already exists and is not an empty directory/,
    text: (m) => (m[1] ? `There's already a folder called "${m[1]}" here, probably from an earlier download. Move into it:`
      : 'There\'s already a folder with that name here, probably from an earlier download.'),
    fix: (m) => (m[1] ? `cd ${q(m[1])}` : 'ls'),
    samples: [{ out: "fatal: destination path 'my site' already exists and is not an empty directory.", fix: "cd 'my site'" }],
  },

  // --- Python and Homebrew ----------------------------------------------------------------------------
  {
    id: 'python-no-module',
    match: /ModuleNotFoundError: No module named '([\w.-]+)'/,
    text: (m) => (m[1] ? `Python can't find "${m[1].split('.')[0]}", so it isn't installed yet.` : 'Python can\'t find a package this needs, so it isn\'t installed yet.'),
    fix: (m) => (m[1] ? `pip3 install ${m[1].split('.')[0]}` : null),
    samples: [{ out: "Traceback (most recent call last):\n  File \"app.py\", line 1, in <module>\n    import requests\nModuleNotFoundError: No module named 'requests'", fix: 'pip3 install requests' }],
  },
  {
    id: 'pip-externally-managed',
    match: /externally-managed-environment/,
    text: () => 'This Python belongs to Homebrew, so packages go in a space just for your project (a "virtual environment"). This makes one and switches to it:',
    fix: () => 'python3 -m venv .venv && source .venv/bin/activate',
    samples: ['error: externally-managed-environment\n\n× This environment is externally managed'],
  },
  {
    id: 'brew-no-formula',
    match: /No available formula(?: or cask)? with the name "([^"]+)"/,
    text: (m) => (m[1] ? `Homebrew has nothing called "${m[1]}". Search for the right name:` : 'Homebrew has nothing by that name. Check the spelling with brew search.'),
    fix: (m) => (m[1] ? `brew search ${q(m[1])}` : null),
    samples: [{ out: 'Warning: No available formula with the name "nodejs". Did you mean node?', fix: 'brew search nodejs' }],
  },

  // --- The Mac ----------------------------------------------------------------------------------------
  {
    id: 'xcode-tools-broken',
    match: /xcrun: error: invalid active developer path/,
    text: () => 'Apple\'s developer tools need reinstalling. This often happens after a macOS update.',
    fix: () => 'xcode-select --install',
    samples: ['xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun'],
  },
  {
    id: 'mac-privacy',
    match: /operation not permitted/i,
    text: () => 'macOS hasn\'t let Fork into this folder. This opens Privacy & Security → Files & Folders: turn the folder on for Fork, then try again.',
    fix: () => PRIVACY,
    samples: ['ls: Desktop: Operation not permitted', 'zsh: operation not permitted: ./install.sh',
      'Error: EPERM: operation not permitted, uv_cwd\n    at process.wrappedCwd [as cwd] (node:internal/bootstrap/switches/does_own_process_state:126:28)'],
  },

  // --- Files and folders ------------------------------------------------------------------------------
  {
    id: 'script-not-runnable',
    match: /(?:zsh|bash|sh): permission denied: (\.{0,2}\/[^\s]+)/,
    text: (m) => (m[1] ? `"${m[1]}" isn't allowed to run yet. This marks it as a program you can run:` : 'That file isn\'t allowed to run yet. chmod +x and its name marks it as a program you can run.'),
    fix: (m) => (m[1] ? `chmod +x ${q(m[1])}` : null),
    samples: [{ out: 'zsh: permission denied: ./build.sh', fix: 'chmod +x ./build.sh' }],
  },
  {
    id: 'permission-denied',
    match: /Permission denied|EACCES/,
    text: () => 'Your account isn\'t allowed to change this: it may belong to macOS or another app. Avoid sudo unless you know exactly why it\'s needed.',
    samples: ['mkdir: /usr/local/share/thing: Permission denied', "cp: /Applications/Tool.app: Permission denied"],
  },
  {
    id: 'not-a-folder',
    match: /cd: not a directory: (.+)|: Not a directory/,
    text: (m) => (m[1] ? `"${m[1].trim()}" is a file, not a folder, so you can't move into it.` : 'Part of that path is a file, not a folder.'),
    samples: ['cd: not a directory: index.html'],
  },
  {
    id: 'no-such-file',
    match: /no such file or directory: (.+)|: ([^:\n]+): No such file or directory|No such file or directory/i,
    text: (m) => {
      const name = first(m)?.trim();
      return name ? `There's nothing called "${name}" here. Here's what is:` : 'That file or folder isn\'t there. Here\'s what is:';
    },
    fix: () => 'ls',
    samples: [
      { out: 'cd: no such file or directory: my-site', fix: 'ls' },
      'ls: hero.png: No such file or directory',
      "python3: can't open file '/Users/me/app.py': [Errno 2] No such file or directory",
    ],
  },
  {
    id: 'is-a-folder',
    match: /Is a directory/,
    text: () => 'That\'s a folder, not a file. To look inside it, move into it or list it with ls.',
    samples: ['cat: src: Is a directory'],
  },
  {
    id: 'already-exists',
    match: /mkdir: ([^:\n]+): File exists|File exists/,
    text: (m) => (m[1] ? `There's already something called "${m[1]}" here.` : 'Something with that name is already here.'),
    samples: ['mkdir: designs: File exists'],
  },
  {
    id: 'folder-not-empty',
    match: /Directory not empty/,
    text: () => 'That folder still has things in it, so it can\'t be removed this way. rm -r moves it and everything in it to the Trash.',
    samples: ['rmdir: old-designs: Directory not empty'],
  },

  // --- Last: a program that isn't there -------------------------------------------------------------
  {
    id: 'command-not-found',
    match: /(?:zsh|bash): command not found: ([\w.+-]+)|^(?:zsh|bash): ([\w.+-]+): command not found/m,
    text: (m, ctx) => MISSING[first(m)]?.(ctx)[0]
      ?? `Fork can't find a program called ${first(m) ? `"${first(m)}"` : 'that'}. Check the spelling, or it may not be installed yet.`,
    fix: (m, ctx) => MISSING[first(m)]?.(ctx)[1] ?? null,
    samples: [
      { out: 'zsh: command not found: npm', ctx: { hasBrew: true }, fix: 'brew install node' },
      { out: 'zsh: command not found: node', ctx: { hasBrew: false }, fix: null },
      { out: 'zsh: command not found: brew', fix: HOMEBREW },
      { out: 'zsh: command not found: git', fix: 'xcode-select --install' },
      { out: 'zsh: command not found: python', fix: null },
      { out: 'zsh: command not found: claude', fix: 'curl -fsSL https://claude.ai/install.sh | bash' },
      { out: 'zsh: command not found: codex', ctx: { hasBrew: true }, fix: 'brew install --cask codex' },
      { out: 'zsh: command not found: gti', fix: null },
      'bash: code: command not found',
    ],
  },
];

// Normal output of a failed command that no entry should claim (checked by npm run check).
export const NOT_ERRORS = [
  'total 16\ndrwxr-xr-x  4 me  staff  128 Sep 27 10:00 .\n-rw-r--r--  1 me  staff  512 Sep 27 10:00 README.md',
  '> my-site@0.1.0 build\n> next build\n\n  ▲ Next.js 15.0.0\n   Creating an optimized production build ...',
  'FAIL  src/App.test.tsx\n  ● renders the hero\n    expect(received).toBe(expected)',
  'Error: Something unexpected happened in the build step',
  'On branch main\nChanges to be committed:\n\tnew file:   hero.png',
  '    at Object.<anonymous> (/Users/me/app/index.js:3:9)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)',
  'SyntaxError: Unexpected token \'}\' in /Users/me/app/index.js:12',
  'warning: in the working copy of \'index.html\', LF will be replaced by CRLF the next time Git touches it',
  'curl: (22) The requested URL returned error: 500',
  '✖ 3 problems (3 errors, 0 warnings)',
];

// An AI's "fix" is only typed into the terminal if it reads like a command, not a sentence.
export const looksLikeCommand = (s) => typeof s === 'string' && s.length < 300 && !s.includes('\n')
  && /^(?:[A-Z_]+=\S+\s+)*[a-z0-9_.~\/-][\w.~\/+-]*(?:\s|$)/.test(s.trim()) && !/[.!?]$/.test(s.trim());

const strip = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, '');
const CTX = { pm: 'npm', scripts: [], hasNodeModules: false, nvmrc: false, hasBrew: false, hasGh: false };

// An entry's words and fix without a text match (Jev picked it): no names or ports, just the general case.
export function explainEntry(id, ctx = {}) {
  const e = ERRORS.find((x) => x.id === id);
  if (!e) return null;
  const c = { ...CTX, ...ctx }, m = [''];
  return { id, text: e.text(m, c), fix: e.fix?.(m, c) ?? null };
}

// The first entry that matches what the failed command printed, or null ("This one's unusual").
export function diagnose(output, ctx = {}) {
  const text = strip(String(output || '')), c = { ...CTX, ...ctx };
  for (const e of ERRORS) {
    const m = e.match.exec(text);
    if (m) return { id: e.id, text: e.text(m, c), fix: e.fix?.(m, c) ?? null };
  }
  return null;
}
