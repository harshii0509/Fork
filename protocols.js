// What terminal apps (Claude Code, OpenCode and anything built with OpenTUI) ask of a terminal, and how
// Fork tells which AI tool is open and whether it's working. Pure functions, no DOM: check.mjs tests them.
window.Protocols = (() => {
  const b64text = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const clean = (s) => s.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();

  // "Done" / "needs you" notifications, in the three ways apps send them. Returns { title, body } or null.
  // OSC 9 is iTerm's (just a message; 9;1 … 9;12 are ConEmu's other uses, like 9;4 progress).
  // OSC 777 is notify;title;body. OSC 99 is kitty's: see kitty99 below.
  const notifyFrom = (code, data) => {
    if (code === 9) return /^\d+(;|$)/.test(data) ? null : { title: '', body: clean(data) };
    if (code === 777) {
      const [kind, title = '', ...body] = data.split(';');
      return kind === 'notify' ? { title: clean(title), body: clean(body.join(';')) } : null;
    }
    return null;
  };

  // OSC 99 (kitty) comes as `key=value:key=value;payload`, in chunks with one id: p= says whether
  // it's the title or the body, e=1 means base64, d=0 means more is coming. p=? asks what we support.
  // One kitty99() per pane keeps the half-built notification between chunks.
  const kitty99 = () => {
    const parts = new Map(); // id -> { title, body }
    return (data) => {
      const at = data.indexOf(';');
      const meta = Object.fromEntries((at < 0 ? data : data.slice(0, at)).split(':').filter(Boolean).map((kv) => kv.split('=')));
      let text = at < 0 ? '' : data.slice(at + 1);
      const id = meta.i || '';
      if (meta.p === '?') return { query: id };
      if (meta.e === '1') try { text = b64text(text); } catch { return null; }
      const part = parts.get(id) || { title: '', body: '' };
      if (meta.p === 'body') part.body += text;
      else if (!meta.p || meta.p === 'title') part.title += text;
      if (meta.d === '0') { parts.set(id, part); return null; }
      parts.delete(id);
      return part.title || part.body ? { title: clean(part.title), body: clean(part.body) } : null;
    };
  };
  // Our answer to p=?: titles and bodies, shown always or only while Fork isn't in front.
  const kitty99Reply = (id) => `\x1b]99;i=${id}:p=?;p=title,body:a=focus:o=always,unfocused,invisible:u=0,1,2\x1b\\`;

  // OSC 52: an app copying text to your clipboard (OpenCode does this when you select its text).
  // Only writes: a "?" asks to read your clipboard, and apps never get that. Over 1 MB is ignored.
  const CLIP_MAX = 1024 * 1024;
  const clipFrom = (data) => {
    const at = data.indexOf(';');
    if (at < 0) return null;
    const b64 = data.slice(at + 1);
    if (!b64 || b64 === '?' || b64.length > (CLIP_MAX * 4) / 3 + 4) return null;
    try { return b64text(b64); } catch { return null; }
  };

  // The AI tools Fork knows by name. A tool is "open" while its command runs; whether it's working comes
  // from its title (Claude: a spinner first while it works, ✳ while it waits for you) or, for the others,
  // from the "esc to interrupt" hint they show at the bottom only while they work.
  const AGENTS = {
    claude: { key: 'claude', name: 'Claude', leave: 'Type /exit to leave it first.', titled: true },
    opencode: { key: 'opencode', name: 'OpenCode', leave: 'Type /exit to leave it first.' },
    codex: { key: 'codex', name: 'Codex', leave: 'Type /exit to leave it first.' },
    gemini: { key: 'gemini', name: 'Gemini', leave: 'Type /quit to leave it first.' },
  };
  // A tool started some other way (`cd x && claude`, an alias) still names itself in the title.
  const agentFromTitle = (title) => (title.startsWith('✳ ') ? 'claude' : /^(OpenCode$|OC \| )/.test(title) ? 'opencode' : null);
  // Claude's title: is it working (true), waiting for you (false), or not a Claude title at all (null)?
  const claudeTitle = (title) => (/^\S /.test(title) ? !title.startsWith('✳') : null);
  // What the tool is working on, from its title, for the terminal's name: "✳ Fix login bug" or
  // "OC | Fix login bug" → "Fix login bug". The tool's own name ("✳ Claude Code", "OpenCode") isn't a task.
  const taskFromTitle = (title) => {
    const m = /^OC \| (.+)/.exec(title) || /^\S (.+)/.exec(title);
    const task = m?.[1].trim();
    if (!task || /^(Claude Code|OpenCode)$/i.test(task)) return null;
    return task.length > 40 ? `${task.slice(0, 39).trimEnd()}…` : task;
  };
  // The bottom lines of the screen: "esc interrupt" (OpenCode), "esc to interrupt" (Codex, Claude), "esc to cancel" (Gemini).
  const interruptHint = (text) => /\besc(ape)?\s+(again\s+)?(to\s+)?(interrupt|cancel)\b/i.test(text);

  return { notifyFrom, kitty99, kitty99Reply, clipFrom, AGENTS, agentFromTitle, claudeTitle, taskFromTitle, interruptHint };
})();
