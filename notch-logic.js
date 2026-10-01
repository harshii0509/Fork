// What the notch shows (notch.js draws it). Pure functions, no DOM: check.mjs tests them.
// tabs: every Fork tab, from every window: { name, state, label, tool, agent, since, pane, win }.
// state is a LOOKS key from renderer.js: running, failed, done, dozing or ready.
// moments: things that just happened ({ kind: done | failed | app, title, body, at, … }), newest first.
window.NotchLogic = (() => {
  const MOMENT_MS = 6000; // how long "Claude's done" stays before the notch goes back
  const MAX_MOMENTS = 3;

  // 12s, 4m, 1h 20m
  const ago = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const workTitle = (t) => (t.agent ? `${t.tool} is working` : t.tool ? `${t.tool} is running` : 'Something is running');
  const line = (t, now) => (t.state === 'running' ? `${workTitle(t)} · ${ago(now - t.since)}` : t.label);

  // A new moment goes first; only the newest few are kept.
  const add = (moments, m, now) => [{ ...m, at: now }, ...moments.filter((x) => now - x.at < MOMENT_MS)].slice(0, MAX_MOMENTS);

  // Most pressing first: you're hovering it (every tab), something just happened, something's working, nothing.
  const pick = ({ tabs, moments, hover, now }) => {
    if (hover && tabs.length) return { mode: 'list', rows: tabs.map((t) => ({ ...t, line: line(t, now) })) };
    const m = moments.find((x) => now - x.at < MOMENT_MS);
    if (m) return { mode: 'moment', ...m };
    const work = tabs.filter((t) => t.state === 'running');
    if (work.length === 1) {
      const t = work[0];
      return { mode: 'working', target: t, title: workTitle(t), body: `in ${t.name} · ${ago(now - t.since)}` };
    }
    if (work.length > 1) {
      return { mode: 'working', target: work[0], title: `${work.length} things working`, body: `in ${[...new Set(work.map((t) => t.name))].join(', ')}` };
    }
    return { mode: 'idle' };
  };

  return { MOMENT_MS, ago, add, pick };
})();
