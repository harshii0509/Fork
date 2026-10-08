// The side panel's Changes view: what an agent's turn did to your app, as a picture from before it started and
// one from after it finished (main.js takes them, shots.mjs keeps them). Side by side, or one over the other with a
// slider to wipe between them. Below: the files it changed, and a strip of earlier turns. renderer.js decides
// when a turn starts and ends; this draws the turns of the open workspace's folder.
window.Changes = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');
  let cb = {}, dir = null, turns = [], sel = null, mode = 'side', at = 50, loading = 0;

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago`
      : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const pageOf = (url) => { try { const u = new URL(url); return u.pathname + u.search === '/' ? u.host : u.pathname + u.search; } catch { return url; } };
  const current = () => turns.find((t) => t.id === sel) || turns[0] || null;

  function setup(opts) {
    cb = opts;
    try { mode = localStorage.getItem('dt-changes-mode') === 'slide' ? 'slide' : 'side'; } catch {}
    const act = {
      side: () => setMode('side'), slide: () => setMode('slide'),
      pin: async (t) => { turns = await dt.turnPin(dir, t.id, !t.pinned); draw(); },
      forget: async (t) => {
        const i = turns.indexOf(t);
        turns = await dt.turnRemove(dir, t.id);
        sel = turns[Math.min(i, turns.length - 1)]?.id ?? null;
        draw();
      },
      open: (t) => cb.openApp(t.url),
    };
    $('pvChanges').addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'), t = current();
      if (a && t) return act[a.dataset.act]?.(t);
      const f = e.target.closest('[data-file]');
      if (f) return cb.openFile(f.dataset.file);
      const th = e.target.closest('[data-turn]');
      if (th) { sel = th.dataset.turn; draw(); }
    });
    $('pvChanges').addEventListener('pointerdown', (e) => {
      const box = e.target.closest('.ch-slide'); if (!box) return;
      e.preventDefault();
      const move = (x) => { const r = box.getBoundingClientRect(); at = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)); wipe(box); };
      move(e.clientX);
      box.setPointerCapture(e.pointerId);
      box.onpointermove = (m) => move(m.clientX);
      box.onpointerup = () => { box.onpointermove = null; };
    });
    $('pvChanges').addEventListener('keydown', (e) => {
      const box = e.target.closest('.ch-slide');
      if (!box || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      at = Math.min(100, Math.max(0, at + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 2)));
      wipe(box);
    });
    draw();
  }
  function setMode(m) {
    mode = m;
    try { localStorage.setItem('dt-changes-mode', mode); } catch {}
    draw();
  }
  function wipe(box) {
    box.style.setProperty('--at', `${at}%`);
    box.querySelector('.ch-handle').setAttribute('aria-valuenow', String(Math.round(at)));
  }

  // The open workspace's folder (or none): load its turns. Quiet when it's the same folder.
  async function show(folder, { force } = {}) {
    if (folder === dir && !force) return;
    dir = folder;
    const run = ++loading;
    const list = folder ? await dt.turns(folder) : [];
    if (run !== loading) return;
    turns = list; sel = turns[0]?.id ?? null;
    draw();
  }
  // A turn just finished with something to see. Show it if it's this folder's.
  function added(folder, r) {
    if (folder !== dir) return false;
    turns = r.turns; sel = r.turn.id;
    draw();
    return true;
  }

  function draw() {
    const t = current(), view = $('pvChanges');
    if (!t) {
      $('chName').textContent = '';
      view.innerHTML = `<div class="pv-msg"><b>No changes to show yet</b>Start your app in the terminal (like <code>npm run dev</code>) and ask an agent
        to change something. When it's done, what the page looked like before and after shows up here.</div>`;
      return;
    }
    $('chName').innerHTML = `${esc(pageOf(t.url))}<small>${esc(ago(t.done))}</small>`;
    $('chName').title = t.url;
    const b = fileUrl(t.before), a = fileUrl(t.after);
    const stage = mode === 'slide'
      ? `<div class="ch-slide" style="--at:${at}%"><img src="${b}" alt="Before"><img class="ch-after" src="${a}" alt="After">
          <div class="ch-handle" role="slider" tabindex="0" aria-label="Before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(at)}"></div>
          <span class="ch-tag l">Before</span><span class="ch-tag r">After</span></div>`
      : `<div class="ch-side"><figure><figcaption>Before</figcaption><img src="${b}" alt="Before"></figure>
          <figure><figcaption>After</figcaption><img src="${a}" alt="After"></figure></div>`;
    const files = t.files || [], shown = files.slice(0, 8);
    const who = t.agent ? `${esc(t.agent)} changed ` : 'Changed ';
    const list = files.length
      ? `<div class="ch-files"><h3>${who}${files.length} ${files.length === 1 ? 'file' : 'files'}</h3>${shown.map((f) =>
        `<button data-file="${esc(f)}" title="Show ${esc(f)}">${cb.fileIcon(f)}<span>${esc(f.split('/').pop())}</span><small>${esc(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')}</small></button>`).join('')}`
        + (files.length > shown.length ? `<p>and ${files.length - shown.length} more</p>` : '') + '</div>'
      : '';
    const strip = turns.length > 1 ? `<div class="ch-strip" role="list">${turns.map((x) =>
      `<button role="listitem" data-turn="${esc(x.id)}" class="${x.id === t.id ? 'on' : ''}" title="${esc(pageOf(x.url))} · ${esc(ago(x.done))}${x.pinned ? ' · pinned' : ''}">`
      + `<img src="${fileUrl(x.after)}" alt="" loading="lazy"><small>${x.pinned ? '● ' : ''}${esc(ago(x.done))}</small></button>`).join('')}</div>` : '';
    const bar = `<div class="ch-bar"><span class="seg">${[['side', 'Side by side', 'Before and after, side by side'], ['slide', 'Slider', 'One over the other: drag to wipe between them']]
      .map(([v, l, tip]) => `<button data-act="${v}" class="${mode === v ? 'on' : ''}" title="${tip}">${l}</button>`).join('')}</span>`
      + `<button class="pv-act${t.pinned ? ' on' : ''}" data-act="pin" title="${t.pinned ? 'Unpin: it can be cleared out with the old ones' : 'Keep this one: pinned turns are never cleared out'}">${t.pinned ? 'Pinned' : 'Pin'}</button>`
      + '<button class="pv-act" data-act="forget" title="Delete these two pictures">Delete</button>'
      + `<button class="pv-act" data-act="open" title="Show this page in App" aria-label="Show this page in App">${cb.openIcon}</button></div>`;
    view.innerHTML = `${bar}${stage}${list}${strip}`;
  }

  return { setup, show, added, draw, folder: () => dir };
})();
