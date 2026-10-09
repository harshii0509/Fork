// The New workspace window's thinking (renderer.js draws it): is what you typed a project link or a folder
// name, and which rows does the quick search box show for it. Pure functions, no DOM: check.mjs tests them.
window.Picker = (() => {
  // A project link: https://github.com/team/project(.git), any other host the same way, or git@host:team/project.git.
  // Returns { url, name, label: 'team/project' } or null.
  const repoFrom = (text) => {
    const s = String(text || '').trim();
    const m = /^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/*$/.exec(s) || /^git@[^:\s]+:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(s);
    return m ? { url: s, name: m[2], label: `${m[1]}/${m[2]}` } : null;
  };

  // The same rules as files.mjs makeFolder, without touching the disk: null when the name is fine.
  const nameError = (name) => {
    const n = String(name || '').trim();
    return !n || n === '.' || n === '..' || /[/\0]/.test(n) ? 'name' : null;
  };

  const base = (p, home) => (p === home ? 'Home' : p.split('/').pop() || '/');

  // The quick search box's rows, top first. Each row: { kind, label, bold?, detail, path?, repo? }.
  // kind: open (a recent folder or Home), new, pick, clone (focus the box, or act on what's in it), where (pick a parent first).
  // Empty: Recent, then the ways to start. A name: make it here, or somewhere else, then the recent folders that
  // match; one called exactly that goes first, so you open it instead of making a second. A link: get it.
  const paletteRows = (query, recents, home, parentLabel) => {
    const q = String(query || '').trim(), list = recents.includes(home) ? recents : [...recents, home];
    const open = (p) => ({ kind: 'open', label: base(p, home), detail: tildeOf(p, home), path: p, section: 'Recent' });
    if (!q) {
      return [...list.map(open),
        { kind: 'new', label: 'New folder', detail: 'type a name above', section: 'Start' },
        { kind: 'pick', label: 'Choose a folder…', detail: 'any folder on your Mac', section: 'Start' },
        { kind: 'clone', label: 'Get a project from GitHub', detail: 'paste the link above', section: 'Start' }];
    }
    const repo = repoFrom(q);
    if (repo) {
      return [{ kind: 'clone', label: 'Get ', bold: repo.label, after: ' from GitHub', detail: `into ${parentLabel}`, repo },
        { kind: 'where', label: 'Put it somewhere else…', detail: 'pick where it goes', repo }];
    }
    const low = q.toLowerCase(), hits = list.filter((p) => base(p, home).toLowerCase().includes(low));
    const exact = hits.filter((p) => base(p, home).toLowerCase() === low);
    const make = [{ kind: 'new', label: 'Create ', bold: q, detail: `in ${parentLabel}`, name: q },
      { kind: 'where', label: 'Put it somewhere else…', detail: 'pick where it goes', name: q }];
    return [...exact.map((p) => ({ ...open(p), label: 'Open ', bold: base(p, home), section: undefined })), ...make,
      ...hits.filter((p) => !exact.includes(p)).map(open)];
  };
  const tildeOf = (p, home) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);

  return { repoFrom, nameError, paletteRows };
})();
