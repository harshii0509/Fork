// The side panel's Design view: the open project's design system at a glance, read from its own files
// (design.mjs, in main). Colours as swatches, type as samples, spacing as bars, radius as corners, shadows on
// paper, motion as a dot that moves with the real timing when you point at it. A project with a dark theme shows
// both values side by side. It reads again every few seconds while it's on screen, so it follows an agent's edits.
// Click a token to copy how you'd use it (var(--brand)); ⇧-click puts it in the terminal; ⌥-click shows where it's set.
window.Design = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Values go into style attributes only when they can't do more than paint: no url(), no breaking out.
  const safe = (v) => typeof v === 'string' && !/url\(|image-set|expression|[;{}<>\\]/i.test(v); // quotes are fine: esc() turns them into &quot;
  const GROUPS = [
    ['Colours', ['color']],
    ['Type', ['font', 'size', 'weight', 'leading', 'tracking']],
    ['Spacing', ['spacing']],
    ['Radius', ['radius']],
    ['Shadows', ['shadow']],
    ['Motion', ['duration', 'easing']],
  ];
  const THEME_NAME = (t) => (t === 'base' ? 'Default' : t[0].toUpperCase() + t.slice(1));
  const BEZIER = { ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1], linear: [0, 0, 1, 1] };

  let cb = {}, dir = null, data = null, shownAt = 0, timer = 0, run = 0;

  function setup(opts) {
    cb = opts;
    $('pvDesign').addEventListener('click', (e) => {
      const el = e.target.closest('[data-use]'); if (!el) return;
      const tok = data?.tokens[+el.dataset.i];
      if (!tok) return;
      if (e.altKey) return cb.openAt(tok.file, tok.line);
      if (e.shiftKey) return cb.type(tok.use);
      cb.copy(tok.use);
      const label = el.querySelector('.ds-name');
      if (label && !label.dataset.was) {
        label.dataset.was = label.textContent;
        label.textContent = 'Copied';
        setTimeout(() => { label.textContent = label.dataset.was; delete label.dataset.was; }, 1000);
      }
    });
    $('dsRefresh').onclick = () => scan(true);
    draw();
  }

  // While the view is on screen: read now, then every few seconds (main answers from its cache when nothing changed).
  function start(folder) {
    if (folder !== dir) { dir = folder; data = null; shownAt = 0; draw(); }
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) scan(); }, 4000);
    scan();
  }
  function stop() { clearInterval(timer); timer = 0; }
  async function scan(force) {
    const folder = dir, mine = ++run;
    if (!folder) return draw();
    if (force) $('dsRefresh').classList.add('spin');
    const r = await dt.designScan(folder);
    $('dsRefresh').classList.remove('spin');
    if (mine !== run || folder !== dir) return;
    if (r && data && r.at === shownAt && r.tokens.length === data.tokens.length) return head(); // nothing new: keep scroll and hover
    data = r; shownAt = r?.at || 0;
    draw();
  }

  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  function head() {
    const n = data?.tokens.length || 0;
    $('dsName').innerHTML = n ? `${n} ${n === 1 ? 'token' : 'tokens'}<small>updated ${esc(ago(data.at))}</small>` : '';
    $('dsName').title = data?.files?.length ? `From ${data.files.join(', ')}` : '';
  }

  // One token's value in each theme where it differs: [[theme, css]].
  const values = (t) => data.themes.filter((th) => th in t.v).map((th) => [th, t.v[th]]);
  const tip = (t) => esc(`${t.name}\n${values(t).map(([th, v]) => (data.themes.length > 1 ? `${THEME_NAME(th)}: ` : '') + v).join('\n')}${t.alias ? `\n= ${t.alias}` : ''}\n${t.file}${t.line ? ':' + t.line : ''}`);
  const label = (t) => `<span class="ds-name">${esc(t.name)}</span>`;
  const val = (t) => `<span class="ds-val">${esc(t.alias ? `→ ${t.alias}` : t.v.base ?? Object.values(t.v)[0])}</span>`;
  const attrs = (t, i, cls) => `class="ds-tok ${cls}" data-i="${i}" data-use="1" title="${tip(t)}" tabindex="0"`;

  function curve(v) {
    const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(v);
    const p = m ? m.slice(1).map(Number) : BEZIER[v.trim()];
    if (!p) return '';
    const y = (n) => 28 - n * 24, x = (n) => 2 + n * 24;
    return `<svg class="ds-curve" viewBox="0 0 28 30" aria-hidden="true"><path d="M2 28 C ${x(p[0])} ${y(p[1])}, ${x(p[2])} ${y(p[3])}, 26 4"/></svg>`;
  }

  const DRAW = {
    color: (t, i) => `<div ${attrs(t, i, 'ds-color')}><div class="ds-sw">${values(t).map(([th, v]) =>
      `<i${safe(v) ? ` style="background:${esc(v)}"` : ' class="bad"'} title="${esc(THEME_NAME(th))}"></i>`).join('')}</div>${label(t)}${val(t)}</div>`,
    font: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-sample"${safe(t.v.base) ? ` style="font-family:${esc(t.v.base)}"` : ''}>Aa Bb Cc 123</span>${label(t)}${val(t)}</div>`,
    size: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-sample"${safe(t.v.base) ? ` style="font-size:min(44px, ${esc(t.v.base)})"` : ''}>Aa</span>${label(t)}`
      + `<span class="ds-val">${esc(t.v.base)}${t.lh ? ` / ${esc(t.lh)}` : ''}</span></div>`,
    weight: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-sample"${safe(t.v.base) ? ` style="font-weight:${esc(t.v.base)}"` : ''}>Aa</span>${label(t)}${val(t)}</div>`,
    leading: (t, i) => `<div ${attrs(t, i, 'ds-row')}>${label(t)}${val(t)}</div>`,
    tracking: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-sample"${safe(t.v.base) ? ` style="letter-spacing:${esc(t.v.base)}"` : ''}>Tracking</span>${label(t)}${val(t)}</div>`,
    spacing: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-bar"><i${safe(t.v.base) ? ` style="width:min(100%, ${esc(t.v.base)})"` : ''}></i></span>${label(t)}${val(t)}</div>`,
    radius: (t, i) => `<div ${attrs(t, i, 'ds-cell')}><span class="ds-corner"${safe(t.v.base) ? ` style="border-radius:${esc(t.v.base)}"` : ''}></span>${label(t)}${val(t)}</div>`,
    shadow: (t, i) => `<div ${attrs(t, i, 'ds-cell ds-paper')}><span class="ds-card"${safe(t.v.base) ? ` style="box-shadow:${esc(t.v.base)}"` : ''}></span>${label(t)}</div>`,
    duration: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-track"${safe(t.v.base) ? ` style="--d:${esc(t.v.base)}"` : ''}><i></i></span>${label(t)}${val(t)}</div>`,
    easing: (t, i) => `<div ${attrs(t, i, 'ds-row')}><span class="ds-track"${safe(t.v.base) ? ` style="--e:${esc(t.v.base)}"` : ''}><i></i></span>${curve(t.v.base)}${label(t)}${val(t)}</div>`,
  };
  const GRID = { color: 'ds-grid', radius: 'ds-grid', shadow: 'ds-grid' };

  function draw() {
    head();
    const view = $('pvDesign');
    if (!dir) { view.innerHTML = '<div class="pv-msg"><b>Open a project to see its design system</b>Fork reads the colours, type and spacing from its files.</div>'; return; }
    if (!data) { view.innerHTML = '<div class="pv-msg"><b>Reading this project…</b></div>'; return; }
    if (!data.tokens.length) {
      view.innerHTML = `<div class="pv-msg"><b>No design tokens here yet</b>Fork looks for CSS variables (<code>--brand: #4f46e5</code>), Sass variables,
        Tailwind's <code>@theme</code> or <code>tailwind.config</code>, and <code>tokens.json</code>. Ask an agent to pull your colours, type and spacing into variables, and they'll show up here.</div>`;
      return;
    }
    const idx = new Map(data.tokens.map((t, i) => [t, i]));
    const themes = data.themes.length > 1 ? `<div class="ds-themes">${data.themes.map((t) => `<span>${esc(THEME_NAME(t))}</span>`).join('')}</div>` : '';
    let html = `<p class="ds-hint">Click to copy · ⇧-click to put in the terminal · ⌥-click to see where it's set</p>`;
    for (const [title, kinds] of GROUPS) {
      const toks = data.tokens.filter((t) => kinds.includes(t.kind));
      if (!toks.length) continue;
      html += `<section class="ds-group"><h3>${title}<small>${toks.length}</small>${kinds.includes('color') ? themes : ''}</h3>`;
      for (const k of kinds) {
        const of = toks.filter((t) => t.kind === k);
        if (of.length) html += `<div class="${GRID[k] || 'ds-list'}">${of.map((t) => DRAW[k](t, idx.get(t))).join('')}</div>`;
      }
      html += '</section>';
    }
    const other = data.tokens.filter((t) => t.kind === 'other');
    if (other.length) html += `<details class="ds-group ds-other"><summary><h3>Other<small>${other.length}</small></h3></summary><div class="ds-list">${other.map((t) =>
      `<div ${attrs(t, idx.get(t), 'ds-row')}>${label(t)}${val(t)}</div>`).join('')}</div></details>`;
    const top = view.scrollTop;
    view.innerHTML = html;
    view.scrollTop = top;
  }

  return { setup, start, stop, scan, folder: () => dir };
})();
