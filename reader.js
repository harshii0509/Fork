// The side panel's Read view: a PDF (pdf.js) or an EPUB (epub.js) next to the terminal, for reading while
// Claude works. Books keep their own style (fonts, white pages), one page at a time or as one long scroll.
// renderer.js remembers your place in every book. The libraries load the first time a book opens, so they
// never slow down starting Fork. The helpers in `logic` are pure: check.mjs tests them.
window.Reader = (() => {
  const KINDS = { pdf: 'pdf', epub: 'epub' };
  const kindOf = (path) => KINDS[(/\.([^./]+)$/.exec(path || '') || [])[1]?.toLowerCase()] || null;
  const MAX_RECENT = 20;
  // Recent books, newest first, one entry per book.
  const remember = (list, book) =>
    [book, ...(Array.isArray(list) ? list : []).filter((b) => b && typeof b.path === 'string' && b.path !== book.path)].slice(0, MAX_RECENT);
  const percent = (p) => `${Math.round(Math.min(1, Math.max(0, Number(p) || 0)) * 100)}%`;
  const logic = { kindOf, remember, percent, MAX_RECENT };

  let root, stage, cb = {}, view = null, book = null, mode = 'pages';
  const $ = (id) => document.getElementById(id);

  function setup(opts) {
    cb = opts;
    root = $('pvRead'); stage = $('rdStage');
    $('rdPrev').onclick = () => prev();
    $('rdNext').onclick = () => next();
    $('rdDone').onclick = () => { clearDone(); cb.onBack?.(); };
    root.addEventListener('keydown', keys);
    root.addEventListener('wheel', swipe, { passive: true });
    new ResizeObserver(() => view?.layout()).observe(stage);
    sync();
  }
  function sync() {
    root.classList.toggle('has-book', !!book);
    root.classList.toggle('pages', mode === 'pages');
    root.classList.toggle('scroll', mode === 'scroll');
    root.dataset.kind = book?.kind || '';
  }

  // ←/→, Space and Page Up/Down turn pages. In scroll mode the page scrolls as usual.
  function keys(e) {
    if (mode !== 'pages' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key === ' ' ? (e.shiftKey ? 'back' : 'on') : { ArrowRight: 'on', PageDown: 'on', ArrowDown: 'on', ArrowLeft: 'back', PageUp: 'back', ArrowUp: 'back' }[e.key];
    if (!k) return;
    e.preventDefault();
    k === 'on' ? next() : prev();
  }
  // A two-finger swipe sideways turns one page, however long the swipe.
  let swipeX = 0, swipeT = 0, swiped = false;
  function swipe(e) {
    if (mode !== 'pages' || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    clearTimeout(swipeT);
    swipeT = setTimeout(() => { swipeX = 0; swiped = false; }, 180);
    if (swiped) return;
    swipeX += e.deltaX;
    if (Math.abs(swipeX) > 50) { swiped = true; swipeX > 0 ? next() : prev(); }
  }

  const next = () => view?.next();
  const prev = () => view?.prev();
  const moved = (at) => { if (book) cb.onMove?.(book, at); };

  // Open a book: { path, kind, bytes, where?, progress? }. Resolves to { title } once the first page shows.
  async function open(b) {
    close();
    book = { ...b };
    sync();
    root.classList.add('loading');
    try {
      view = await (book.kind === 'pdf' ? pdfView : epubView)(book);
      if (book?.path !== b.path) return null; // another book was opened meanwhile
      return { title: view.title };
    } catch (err) {
      if (book?.path === b.path) close();
      throw err;
    } finally { root.classList.remove('loading'); }
  }
  function close() {
    try { view?.destroy(); } catch {} // a book that won't let go still closes
    view = null; book = null;
    stage.replaceChildren();
    clearDone();
    sync();
  }
  function setMode(m) {
    if (m !== 'pages' && m !== 'scroll') return;
    mode = m;
    sync();
    view?.setMode(m);
  }

  // Whatever you were waiting for is done: say so, without closing the book.
  function workDone(text) {
    $('rdDone').innerHTML = `${text} · <u>Back to terminal</u>`;
    $('rdDone').classList.add('show');
  }
  function clearDone() { $('rdDone')?.classList.remove('show'); }

  // --- PDF: pdf.js draws each page to a canvas. In scroll mode only the pages near the view are drawn. ---
  let pdfjs;
  async function pdfLib() {
    if (!pdfjs) {
      pdfjs = await import('./node_modules/pdfjs-dist/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', location.href).href;
    }
    return pdfjs;
  }

  async function pdfView(b) {
    const lib = await pdfLib();
    const loading = lib.getDocument({ data: b.bytes, isEvalSupported: false });
    const doc = await loading.promise;
    const n = doc.numPages;
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    let cur = Math.min(Math.max(1, Math.round(Number(b.where)) || 1), n);
    const title = (await doc.getMetadata().catch(() => null))?.info?.Title?.trim() || null;

    const wrap = document.createElement('div');
    wrap.className = 'rd-pdf';
    wrap.tabIndex = -1;
    const slots = Array.from({ length: n }, (_, i) => {
      const d = document.createElement('div');
      d.className = 'rd-page';
      d.style.aspectRatio = `${first.width} / ${first.height}`; // until the page itself says otherwise
      d.dataset.n = i + 1;
      wrap.append(d);
      return d;
    });
    stage.append(wrap);

    const drawn = new Map(), tasks = new Map(); // page -> width it's drawn at / its render
    async function draw(i) {
      const slot = slots[i - 1], w = slot.clientWidth;
      if (!w || drawn.get(i) === w) return;
      drawn.set(i, w);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      slot.style.aspectRatio = `${base.width} / ${base.height}`;
      const vp = page.getViewport({ scale: (w / base.width) * (devicePixelRatio || 1) });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      tasks.get(i)?.cancel();
      const task = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
      tasks.set(i, task);
      try { await task.promise; } catch { return; } // replaced by a newer drawing
      if (drawn.get(i) === w) slot.replaceChildren(c);
    }
    function forget(i) { tasks.get(i)?.cancel(); drawn.delete(i); slots[i - 1].replaceChildren(); }

    // Scroll mode: draw pages as they come near, let go of the ones far away (a canvas per page adds up).
    const near = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? draw(+e.target.dataset.n) : forget(+e.target.dataset.n);
    }, { root: wrap, rootMargin: '150% 0px' });

    const report = () => moved({ where: cur, progress: n > 1 ? (cur - 1) / (n - 1) : 1, label: `p. ${cur} / ${n}` });
    function show(i) {
      const was = cur;
      cur = Math.min(Math.max(1, i), n);
      if (mode === 'pages') {
        if (was !== cur) forget(was); // one page drawn at a time
        for (const s of slots) s.classList.toggle('on', +s.dataset.n === cur);
        layout();
      } else wrap.scrollTop = slots[cur - 1].offsetTop - 16; // not scrollIntoView: that would scroll the panel too
      report();
    }
    let ticking = false;
    wrap.addEventListener('scroll', () => {
      if (mode !== 'scroll' || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = wrap.scrollTop + wrap.clientHeight / 3;
        let i = 1;
        while (i < n && slots[i].offsetTop <= y) i++;
        if (i !== cur) { cur = i; report(); }
      });
    });

    function layout() {
      const W = stage.clientWidth, H = stage.clientHeight, pad = 16;
      if (!W || !H) return;
      if (mode === 'pages') {
        const s = slots[cur - 1], [pw, ph] = s.style.aspectRatio.split('/').map(Number);
        s.style.width = `${Math.floor(Math.min(W - 2 * pad - 64, ((H - 2 * pad) * pw) / ph))}px`; // 64: room for ‹ ›
        draw(cur);
      } else {
        const w = `${Math.floor(Math.min(W - 2 * pad, 1000))}px`;
        for (const s of slots) s.style.width = w;
        for (const i of [...drawn.keys()]) if (slots[i - 1].clientWidth !== drawn.get(i)) { drawn.delete(i); draw(i); }
      }
    }
    function setMode() {
      near.disconnect();
      if (mode === 'scroll') {
        for (const s of slots) s.classList.remove('on');
        layout();
        for (const s of slots) near.observe(s);
      } else for (let i = 1; i <= n; i++) if (i !== cur) forget(i);
      show(cur);
    }
    setMode();
    return {
      title,
      layout,
      setMode,
      next: () => show(cur + 1),
      prev: () => show(cur - 1),
      destroy: () => { near.disconnect(); for (const t of tasks.values()) t.cancel(); loading.destroy(); },
    };
  }

  // --- EPUB: epub.js lays the book out in its own frames, with the book's own styles. ---
  const script = (src) => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`couldn't load ${src}`));
    document.head.append(s);
  });
  async function epubLib() {
    if (!window.ePub) { await script('node_modules/jszip/dist/jszip.min.js'); await script('node_modules/epubjs/dist/epub.min.js'); }
    return window.ePub;
  }

  async function epubView(b) {
    const ePub = await epubLib();
    const bk = ePub(b.bytes.buffer.slice(b.bytes.byteOffset, b.bytes.byteOffset + b.bytes.byteLength));
    await bk.opened;
    const title = (await bk.loaded.metadata)?.title?.trim() || null;
    const host = document.createElement('div');
    host.className = 'rd-epub';
    stage.append(host);
    let where = typeof b.where === 'string' ? b.where : undefined, progress = Number(b.progress) || 0, rendition, gone = false;

    const report = () => moved({ where, progress, label: percent(progress) });
    // Web links go to the browser; links within the book, epub.js follows.
    const hook = (contents) => {
      const d = contents.document;
      d.addEventListener('click', (e) => {
        const a = e.target.closest?.('a[href]');
        if (a && /^(https?|mailto):/i.test(a.getAttribute('href'))) { e.preventDefault(); e.stopPropagation(); cb.openExternal?.(a.href); }
      }, true);
      d.addEventListener('keydown', keys);
      d.addEventListener('wheel', swipe, { passive: true });
    };
    async function render() {
      rendition?.destroy();
      host.replaceChildren();
      rendition = bk.renderTo(host, mode === 'pages'
        ? { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false }
        : { width: '100%', height: '100%', flow: 'scrolled', manager: 'continuous', allowScriptedContent: false });
      rendition.hooks.content.register(hook);
      rendition.on('relocated', (loc) => {
        where = loc.start.cfi;
        if (bk.locations.length()) progress = bk.locations.percentageFromCfi(where);
        report();
      });
      try { await rendition.display(where); } catch { where = undefined; await rendition.display(); } // a saved place that no longer fits
    }
    await render();
    // How far through the book you are needs the whole book measured once: do it after the first page shows.
    bk.locations.generate(1200).then(() => {
      if (gone || !where) return;
      progress = bk.locations.percentageFromCfi(where);
      report();
    }).catch(() => {});
    return {
      title,
      layout: () => {}, // epub.js follows its frame's size itself
      setMode: () => render(),
      next: () => rendition?.next(),
      prev: () => rendition?.prev(),
      destroy: () => { gone = true; rendition?.destroy(); bk.destroy(); },
    };
  }

  return { logic, kindOf, setup, open, close, setMode, next, prev, workDone, clearDone, current: () => book };
})();
