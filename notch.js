// The notch: what your terminals are doing, while you're in another app. main.js owns the window and
// sends every tab's state plus the moments (done, failed, app ready); NotchLogic.pick decides what shows.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = new URLSearchParams(location.search);
  const NH = +q.get('h') || 32, NW = +q.get('w') || 185;
  const SIDE = 56; // each side of the notch: the blob on the left, the time or Done/Failed/Ready on the right
  document.documentElement.style.setProperty('--nw', `${NW}px`);
  document.documentElement.style.setProperty('--nh', `${NH}px`);
  document.documentElement.style.setProperty('--side', `${SIDE}px`);

  let tabs = [], moments = [], hover = false, view = { mode: 'idle' }, tick = 0, momentTimer = 0, drawn = '';

  // The blob beside the notch, and one per tab in the list (kept between redraws so they keep animating).
  const LOOK = {
    running: ['thinking'], done: ['notify'], failed: ['idle', 'sad', 'bad'], dozing: ['sleep'], ready: ['idle'],
    app: ['idle', 'happy'],
  };
  const sideBlob = Blobs.status(20);
  const rowBlobs = new Map();
  const rowBlob = (key) => { if (!rowBlobs.has(key)) rowBlobs.set(key, Blobs.status(20)); return rowBlobs.get(key); };
  const look = (blob, key) => blob.set(...(LOOK[key] || LOOK.ready));

  // The shape's width and height in each mode. Working and moments stay in the menu bar, beside the
  // notch; only hovering (the list) grows down below it.
  const SIZES = {
    working: () => [NW + 2 * SIDE, NH],
    moment: () => [NW + 2 * SIDE, NH],
    list: (n) => [360, NH + 8 + Math.min(n, 6) * 46 - 2 + 12], // rows are 44 + 2 apart; 8 above, 12 below
  };

  function render() {
    const now = Date.now();
    view = NotchLogic.pick({ tabs, moments, hover, now });
    const shape = $('shape'), content = $('content');
    shape.classList.toggle('open', view.mode !== 'idle');
    shape.classList.toggle('compact', view.mode === 'working' || view.mode === 'moment');
    if (view.mode === 'idle') {
      shape.style.width = shape.style.height = '';
      // Leave what was there while the shape closes, so it fades rather than vanishes.
    } else {
      const [w, h] = SIZES[view.mode](view.rows?.length);
      shape.style.width = `${w}px`;
      shape.style.height = `${h}px`;
    }
    // Only the words changed (the clock ticking)? Update them in place, so a click mid-redraw still lands.
    const sig = view.mode === 'list' ? view.rows.map((r) => `${r.win}:${r.pane}:${r.name}:${r.state}`).join('|')
      : `${view.mode}:${view.kind}:${view.title}:${view.at}`;
    if (sig === drawn && view.mode !== 'idle') {
      const bodies = content.querySelectorAll('.body');
      if (view.mode === 'list') view.rows.forEach((r, i) => { bodies[i].textContent = r.line; });
      else content.querySelector('.side').textContent = view.side;
    } else if (view.mode === 'list') {
      const keys = view.rows.map((r) => `${r.win}:${r.pane}:${r.name}`);
      for (const [k, b] of rowBlobs) if (!keys.includes(k)) { b.destroy(); rowBlobs.delete(k); }
      content.innerHTML = `<div class="list">${view.rows.map((r, i) => `
        <div class="row" data-i="${i}"><span class="slot"></span>
          <div class="text"><div class="title">${esc(r.name)}</div><div class="body">${esc(r.line)}</div></div></div>`).join('')}</div>`;
      content.querySelectorAll('.slot').forEach((slot, i) => {
        const b = rowBlob(keys[i]);
        look(b, view.rows[i].state);
        slot.replaceWith(b.el);
      });
    } else if (view.mode !== 'idle') {
      const kind = view.mode === 'working' ? 'running' : view.kind;
      content.innerHTML = `<div class="beside ${kind}" title="${esc(`${view.title} ${view.body}`)}">
        <span class="left"><span class="slot"></span></span><span class="camera"></span><span class="side">${esc(view.side)}</span></div>`;
      look(sideBlob, kind);
      content.querySelector('.slot').replaceWith(sideBlob.el);
    }
    if (view.mode !== 'idle') drawn = sig;
    // The time ticks while something's working or the list is open.
    clearInterval(tick);
    if (view.mode === 'working' || view.mode === 'list') tick = setInterval(render, 1000);
  }

  notch.onState((t) => { tabs = t; render(); });
  notch.onMoment((m) => {
    moments = NotchLogic.add(moments, m, Date.now());
    render();
    clearTimeout(momentTimer);
    momentTimer = setTimeout(render, NotchLogic.MOMENT_MS + 50);
  });

  // The window ignores the mouse except over the shape (main.js). Hover opens the list after a beat,
  // so passing the cursor over the notch on the way to the menu bar doesn't.
  let hoverTimer = 0;
  $('shape').addEventListener('mouseenter', () => {
    notch.mouse(true);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { hover = true; render(); }, 180);
  });
  $('shape').addEventListener('mouseleave', () => {
    notch.mouse(false);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { hover = false; render(); }, 300);
  });

  $('content').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) { const r = view.rows[+row.dataset.i]; return notch.go({ win: r.win, pane: r.pane, kind: 'tab' }); }
    if (!e.target.closest('.beside')) return;
    const t = view.mode === 'working' ? view.target : view;
    notch.go({ win: t.win, pane: t.pane, action: view.mode === 'moment' ? view.kind : null, url: view.url, kind: view.mode === 'moment' ? view.kind : 'working' });
  });

  render();
})();
