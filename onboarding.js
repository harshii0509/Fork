// First run: three welcome cards, then a spotlight tour of the app, one part at a time.
// The words are plain data (check.mjs tests them); welcome() and tour() drive the DOM and
// resolve when the person finishes or skips. renderer.js decides when each runs.
window.Onboarding = (() => {
  const CARDS = [
    { title: 'A terminal is a chat with your computer',
      text: 'You type what you want and it does it. Fork shows you the words, so you never have to remember them.' },
    { title: 'Fork does the typing for you',
      text: 'Click a folder, a file or a suggestion, and Fork puts the real command in the terminal. Anything that can’t be undone asks first.' },
    { title: 'Stuck? Just ask',
      text: 'Press ⌘⇧K and say what you want in plain words. If something goes wrong, Fork explains it and suggests a fix.' },
  ];

  // Each step lights up everything its targets cover. A step with nothing on screen (no suggestions
  // in this folder, say) is left out, and the count says so. place: where the card sits.
  const STEPS = [
    { targets: ['#term'], place: 'inside', title: 'This is the terminal',
      text: 'Commands show up here, and so does whatever they print. You can type here too, then press Enter.' },
    { targets: ['.side-files'], place: 'right', title: 'What’s in this folder',
      text: 'The files in the folder you’re in. Open folders in place, click a file to preview it, or drag one into the terminal to use its path. Right-click for more.' },
    { targets: ['#searchBox'], place: 'right', title: 'Search this folder (⌘K)',
      text: 'Type a word to find files by name, and the lines inside files that have it. Click one to see it. Want to do something instead? ⌘⇧K, in plain words.' },
    { targets: ['#pvToggle'], place: 'below', title: 'Preview (⌘P)',
      text: 'See a file, or your app while it’s running, right beside the terminal.' },
    { targets: ['#tabs', '#newTab'], place: 'below', title: 'Your workspaces',
      text: 'Each tab is a folder you work in: its files, branch and what’s changed show in the sidebar, wherever its terminals go. + or ⌘N opens another folder, and ⌘T adds a terminal next to the ones you have.' },
  ];

  const $ = (id) => document.getElementById(id);
  // Arrows, Enter and Esc belong to the onboarding while it's up, not to the terminal underneath.
  const keys = (map) => {
    const on = (e) => { const fn = map[e.key]; if (fn) { e.preventDefault(); e.stopPropagation(); fn(); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  };

  // --- Welcome cards (#welcomeOv in index.html) -------------------------------------------------
  function welcome() {
    return new Promise((resolve) => {
      let i = 0;
      const show = () => {
        const c = CARDS[i];
        $('welcomeTitle').textContent = c.title;
        $('welcomeText').textContent = c.text;
        $('welcomeDots').innerHTML = CARDS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('');
        $('welcomeNext').textContent = i === CARDS.length - 1 ? 'Get started' : 'Next';
      };
      const end = (done) => {
        unkey();
        $('welcomeOv').classList.remove('show');
        $('welcomeNext').onclick = $('welcomeSkip').onclick = null;
        resolve({ done, card: i + 1 });
      };
      const next = () => (i === CARDS.length - 1 ? end(true) : (i++, show()));
      const back = () => { if (i > 0) { i--; show(); } };
      const unkey = keys({ ArrowRight: next, Enter: next, ArrowLeft: back, Escape: () => end(false) });
      $('welcomeNext').onclick = next;
      $('welcomeSkip').onclick = () => end(false);
      show();
      $('welcomeOv').classList.add('show');
    });
  }

  // --- Spotlight tour -------------------------------------------------------------------------
  const PAD = 6, GAP = 12, EDGE = 12;
  // Everything a step's targets cover, padded, kept on screen. null = nothing of it is visible.
  function areaOf(step) {
    const rs = step.targets.flatMap((sel) => [...document.querySelectorAll(sel)])
      .filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const top = Math.max(Math.min(...rs.map((r) => r.top)) - PAD, 4);
    const left = Math.max(Math.min(...rs.map((r) => r.left)) - PAD, 4);
    const bottom = Math.min(Math.max(...rs.map((r) => r.bottom)) + PAD, innerHeight - 4);
    const right = Math.min(Math.max(...rs.map((r) => r.right)) + PAD, innerWidth - 4);
    return bottom > top && right > left ? { top, left, width: right - left, height: bottom - top, bottom, right } : null;
  }
  // Beside the lit area, flipped or nudged so the card always stays on screen.
  function placeTip(tip, a, place) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x, y;
    if (place === 'inside') { x = a.left + (a.width - w) / 2; y = a.top + (a.height - h) / 2; }
    else if (place === 'below') { x = a.right - w; y = a.bottom + GAP; if (y + h > innerHeight - EDGE) y = a.top - GAP - h; }
    else { x = a.right + GAP; y = a.top; if (x + w > innerWidth - EDGE) x = a.left - GAP - w; }
    tip.style.left = Math.round(Math.min(Math.max(x, EDGE), innerWidth - w - EDGE)) + 'px';
    tip.style.top = Math.round(Math.min(Math.max(y, EDGE), innerHeight - h - EDGE)) + 'px';
  }

  function tour() {
    return new Promise((resolve) => {
      const steps = STEPS.filter((s) => areaOf(s));
      if (!steps.length) return resolve({ done: true, step: 0, of: 0 });
      const root = document.createElement('div');
      root.className = 'tour';
      root.innerHTML = `<div class="tour-block"></div><div class="spot"></div>
        <div class="card tour-tip" role="dialog" aria-live="polite"><div class="tour-count"></div><h2></h2><p></p>
          <div class="tour-actions"><button class="skip">Skip tour</button><span>
            <button class="tour-back">Back</button><button class="go">Next</button></span></div></div>`;
      document.body.append(root);
      const spot = root.querySelector('.spot'), tip = root.querySelector('.tour-tip');
      const [skipBtn, backBtn, nextBtn] = tip.querySelectorAll('button');
      let i = 0;
      const layout = () => {
        const a = areaOf(steps[i]);
        if (!a) return;
        Object.assign(spot.style, { top: a.top + 'px', left: a.left + 'px', width: a.width + 'px', height: a.height + 'px' });
        placeTip(tip, a, steps[i].place);
      };
      const show = () => {
        const s = steps[i];
        tip.querySelector('.tour-count').textContent = `${i + 1} of ${steps.length}`;
        tip.querySelector('h2').textContent = s.title;
        tip.querySelector('p').textContent = s.text;
        backBtn.hidden = i === 0;
        nextBtn.textContent = i === steps.length - 1 ? 'Done' : 'Next';
        layout();
      };
      const end = (done) => {
        unkey();
        removeEventListener('resize', layout);
        root.classList.remove('show');
        setTimeout(() => root.remove(), 200);
        resolve({ done, step: i + 1, of: steps.length });
      };
      const next = () => (i === steps.length - 1 ? end(true) : (i++, show()));
      const back = () => { if (i > 0) { i--; show(); } };
      const unkey = keys({ ArrowRight: next, Enter: next, ArrowLeft: back, Escape: () => end(false) });
      nextBtn.onclick = next;
      backBtn.onclick = back;
      skipBtn.onclick = () => end(false);
      addEventListener('resize', layout);
      show();
      requestAnimationFrame(() => root.classList.add('show')); // fade in, then glide between steps
    });
  }

  return { CARDS, STEPS, welcome, tour };
})();
