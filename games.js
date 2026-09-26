// Little Nokia-style games for while Claude works (or whenever): Snake, Stack and Space Run.
// Each one is drawn on an 84 × 48 pixel screen, the Nokia 3310's, in the theme's colours.
// The rules are plain functions of a game's state (check.mjs tests them). The card, keys, beeps and
// best scores are wired up by setup(), which renderer.js calls. Needs blob.js first (the mascot).
window.Games = (() => {
  const W = 84, H = 48;

  // --- The screen: 0 = off, 1 = ink (theme text), 2 = accent -------------------------------------
  // A 3 × 5 pixel font for the few words and numbers drawn on the screen itself.
  const FONT = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', '!': '010010010000010', ' ': '000000000000000',
  };
  const screen = () => {
    const b = new Uint8Array(W * H);
    const set = (x, y, c = 1) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < W && y < H) b[y * W + x] = c; };
    const rect = (x, y, w, h, c = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    return {
      b, set, rect,
      clear: () => b.fill(0),
      frame: (x, y, w, h, c = 1) => { rect(x, y, w, 1, c); rect(x, y + h - 1, w, 1, c); rect(x, y, 1, h, c); rect(x + w - 1, y, 1, h, c); },
      // Sprites are rows of '#' (on) and '.' (off).
      sprite: (rows, x, y, c = 1) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') set(x + i, y + j, c); }),
      text: (str, x, y, c = 1) => {
        for (const ch of String(str).toUpperCase()) {
          const g = FONT[ch] || FONT[' '];
          for (let k = 0; k < 15; k++) if (g[k] === '1') set(x + (k % 3), y + ((k / 3) | 0), c);
          x += 4;
        }
      },
    };
  };
  const textWidth = (s) => String(s).length * 4 - 1;

  // A seeded random, so check.mjs (and the picker's little previews) get the same game every time.
  const seeded = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (rand, n) => Math.floor(rand() * n);

  // --- Snake: eat, grow, don't hit the wall or yourself ------------------------------------------
  // A 20 × 11 grid of 4-pixel cells inside a border. Each part of the snake is a 3 × 3 square, joined
  // to the next, so it reads as one body like on the phone.
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const snake = {
    id: 'snake', name: 'Snake', hint: 'Arrows to turn · P pause · Esc close',
    COLS: 20, ROWS: 11,
    init(rand) {
      const s = { body: [{ x: 7, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }], dir: 'right', queue: [], score: 0, eaten: 0, over: false, sfx: [] };
      s.food = snake.food(s, rand);
      return s;
    },
    food(s, rand) {
      const free = [];
      for (let y = 0; y < snake.ROWS; y++) for (let x = 0; x < snake.COLS; x++) if (!s.body.some((p) => p.x === x && p.y === y)) free.push({ x, y });
      return free[pick(rand, free.length)];
    },
    // Turns queue up (two at most), so a quick up-then-left between steps works and never reverses you.
    press(s, a) {
      if (!DIRS[a]) return;
      const last = s.queue.at(-1) ?? s.dir;
      if (a !== last && a !== OPP[last] && s.queue.length < 2) s.queue.push(a);
    },
    tick: (s) => Math.max(70, 150 - s.eaten * 3),
    step(s, held, rand) {
      if (s.over) return;
      if (s.queue.length) s.dir = s.queue.shift();
      const [dx, dy] = DIRS[s.dir], h = s.body[0], n = { x: h.x + dx, y: h.y + dy };
      const eat = s.food && n.x === s.food.x && n.y === s.food.y;
      const rest = eat ? s.body : s.body.slice(0, -1); // the tail moves out of the way unless you grow
      if (n.x < 0 || n.y < 0 || n.x >= snake.COLS || n.y >= snake.ROWS || rest.some((p) => p.x === n.x && p.y === n.y)) {
        s.over = true; s.sfx.push('die'); return;
      }
      s.body = [n, ...rest];
      if (eat) { s.score += 1; s.eaten += 1; s.food = snake.food(s, rand); s.sfx.push('eat'); }
    },
    draw(scr, s) {
      scr.frame(0, 0, W, H);
      const at = (p) => [2 + p.x * 4, 2 + p.y * 4];
      s.body.forEach((p, i) => {
        const [x, y] = at(p);
        scr.rect(x, y, 3, 3);
        const q = s.body[i + 1]; // fill the gap to the next part
        if (q) { const [qx, qy] = at(q); scr.rect(Math.min(x, qx) + (qx !== x ? 3 : 0), Math.min(y, qy) + (qy !== y ? 3 : 0), qx !== x ? 1 : 3, qy !== y ? 1 : 3); }
      });
      if (s.food) { const [x, y] = at(s.food); scr.sprite(['.#.', '#.#', '.#.'], x, y, 2); }
    },
  };

  // --- Stack: falling blocks, clear full lines ----------------------------------------------------
  // A 10 × 20 well of 2-pixel blocks in the middle, lines and level on the left, the next piece on the right.
  const PIECES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  const LINE_SCORE = [0, 40, 100, 300, 1200];
  const stack = {
    id: 'stack', name: 'Stack', hint: '← → move · ↑ turn · ↓ drop faster · Space drop · P pause',
    COLS: 10, ROWS: 20,
    init(rand) {
      const s = { board: Array.from({ length: stack.ROWS }, () => Array(stack.COLS).fill(0)), bag: [], score: 0, lines: 0, level: 1, over: false, sfx: [] };
      s.next = stack.draw1(s, rand);
      stack.spawn(s, rand);
      return s;
    },
    draw1(s, rand) { // all seven pieces in a shuffled bag, so you never wait forever for a long one
      if (!s.bag.length) { s.bag = Object.keys(PIECES); for (let i = s.bag.length - 1; i > 0; i--) { const j = pick(rand, i + 1); [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]]; } }
      return s.bag.pop();
    },
    spawn(s, rand) {
      s.piece = { k: s.next, cells: PIECES[s.next].map((c) => c.slice()), x: 3, y: 0 };
      s.next = stack.draw1(s, rand);
      if (!stack.fits(s, s.piece.cells, s.piece.x, s.piece.y)) { s.over = true; s.sfx.push('die'); }
    },
    fits: (s, cells, x, y) => cells.every(([cx, cy]) => {
      const bx = x + cx, by = y + cy;
      return bx >= 0 && bx < stack.COLS && by < stack.ROWS && (by < 0 || !s.board[by][bx]);
    }),
    rotate(s) {
      const p = s.piece;
      if (p.k === 'O') return;
      const n = p.k === 'I' ? 4 : 3;
      const cells = p.cells.map(([x, y]) => [n - 1 - y, x]);
      for (const kick of [0, -1, 1, -2, 2]) if (stack.fits(s, cells, p.x + kick, p.y)) { p.cells = cells; p.x += kick; s.sfx.push('turn'); return; }
    },
    lock(s, rand) {
      for (const [cx, cy] of s.piece.cells) if (s.piece.y + cy >= 0) s.board[s.piece.y + cy][s.piece.x + cx] = 1;
      const kept = s.board.filter((row) => row.some((c) => !c));
      const n = stack.ROWS - kept.length;
      s.board = [...Array.from({ length: n }, () => Array(stack.COLS).fill(0)), ...kept];
      if (n) { s.score += LINE_SCORE[n] * s.level; s.lines += n; s.level = 1 + Math.floor(s.lines / 10); s.sfx.push('line'); }
      else s.sfx.push('land');
      stack.spawn(s, rand);
    },
    press(s, a, rand) {
      if (s.over) return;
      const p = s.piece;
      if (a === 'left' || a === 'right') { const dx = a === 'left' ? -1 : 1; if (stack.fits(s, p.cells, p.x + dx, p.y)) p.x += dx; }
      if (a === 'up') stack.rotate(s);
      if (a === 'down') { if (stack.fits(s, p.cells, p.x, p.y + 1)) { p.y++; s.score += 1; } else stack.lock(s, rand); }
      if (a === 'fire') { while (stack.fits(s, p.cells, p.x, p.y + 1)) { p.y++; s.score += 2; } stack.lock(s, rand); }
    },
    tick: (s) => Math.max(90, 700 - (s.level - 1) * 60),
    step(s, held, rand) {
      if (s.over) return;
      if (stack.fits(s, s.piece.cells, s.piece.x, s.piece.y + 1)) s.piece.y++;
      else stack.lock(s, rand);
    },
    draw(scr, s) {
      const X = 32, Y = 4;
      scr.frame(X - 1, Y - 1, stack.COLS * 2 + 2, stack.ROWS * 2 + 2);
      s.board.forEach((row, y) => row.forEach((c, x) => c && scr.rect(X + x * 2, Y + y * 2, 2, 2)));
      if (!s.over) for (const [cx, cy] of s.piece.cells) if (s.piece.y + cy >= 0) scr.rect(X + (s.piece.x + cx) * 2, Y + (s.piece.y + cy) * 2, 2, 2, 2);
      scr.text('LINES', 5, 6); scr.text(s.lines, 5, 13, 2);
      scr.text('LEVEL', 5, 25); scr.text(s.level, 5, 32, 2);
      scr.text('NEXT', 59, 6);
      for (const [cx, cy] of PIECES[s.next]) scr.rect(59 + cx * 3, 14 + cy * 3, 3, 3);
    },
  };

  // --- Space Run: fly, shoot what comes at you, beat the boss every fifth wave ---------------------
  const SHIP = ['#......', '###....', '.######', '###....', '#......'];
  const FOES = [
    ['..###..', '.#####.', '##.#.##', '.#####.', '#.#.#.#'],
    ['.#...#.', '..###..', '.##.##.', '#######', '#.#.#.#'],
    ['...####', '.######', '###.###', '.######', '...####'],
  ];
  const BOSS = ['....######..', '..##########', '.###..######', '############', '#####.######', '..##....####',
    '..##....####', '#####.######', '############', '.###..######', '..##########', '....######..'];
  const HEART = ['#.#', '###', '.#.'];
  const TOP = 6; // the play area starts below the lives and the boss's health bar
  const hit = (a, aw, ah, b, bw, bh) => a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah;
  const space = {
    id: 'space', name: 'Space Run', hint: '↑ ↓ fly · Space shoot (hold it) · P pause · Esc close',
    init(rand) {
      return {
        ship: { x: 2, y: 24 }, bullets: [], foes: [], shots: [], fx: [], boss: null,
        stars: Array.from({ length: 12 }, () => ({ x: pick(rand, W), y: TOP + pick(rand, H - TOP) })),
        lives: 3, score: 0, wave: 0, t: 0, inv: 0, cool: 0, fire: false, over: false, sfx: [],
      };
    },
    press(s, a) { if (a === 'fire') s.fire = true; },
    tick: () => 33,
    wave(s, rand) {
      s.wave++;
      if (s.wave % 5 === 0) { s.boss = { x: W + 2, y: 20, dy: 1, hp: 16 + s.wave * 2, max: 16 + s.wave * 2 }; return; }
      const n = 3 + Math.min(s.wave, 6);
      for (let i = 0; i < n; i++) {
        const type = Math.min(pick(rand, 1 + Math.min(s.wave, 3)), 2);
        const y = TOP + 2 + pick(rand, H - TOP - 9);
        s.foes.push({ x: W + i * 13, y, base: y, type, ph: rand() * 6.28, speed: 0.5 + Math.min(s.wave, 8) * 0.06 });
      }
    },
    hurt(s) {
      if (s.inv) return;
      s.lives--; s.inv = 60; s.sfx.push('hit');
      s.fx.push({ x: s.ship.x + 3, y: s.ship.y + 2, t: 0 });
      if (s.lives <= 0) { s.over = true; s.sfx.push('die'); }
    },
    step(s, held, rand) {
      if (s.over) return;
      s.t++;
      for (const st of s.stars) if (s.t % 2 === 0 && --st.x < 0) { st.x = W - 1; st.y = TOP + pick(rand, H - TOP); }
      const sh = s.ship;
      sh.y = Math.max(TOP, Math.min(H - 5, sh.y + (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)));
      if (s.cool > 0) s.cool--;
      if ((s.fire || held.has('fire')) && !s.cool) { s.bullets.push({ x: sh.x + 7, y: sh.y + 2 }); s.cool = 6; s.sfx.push('shoot'); }
      s.fire = false;
      if (s.inv) s.inv--;

      for (const b of s.bullets) b.x += 3;
      for (const f of s.foes) {
        f.x -= f.speed;
        if (f.type === 1) f.y = Math.round(f.base + 4 * Math.sin(s.t / 9 + f.ph));
        if (f.type === 2 && f.x < W - 8 && pick(rand, 90) === 0) s.shots.push({ x: f.x - 1, y: f.y + 2 });
      }
      const bo = s.boss;
      if (bo) {
        if (bo.x > W - 14) bo.x -= 0.5;
        bo.y += bo.dy * 0.5;
        if (bo.y < TOP + 1 || bo.y > H - 13) bo.dy *= -1;
        if (s.t % 40 === 0) for (const dy of [2, 6, 10]) s.shots.push({ x: bo.x - 1, y: Math.round(bo.y) + dy });
      }
      for (const sht of s.shots) sht.x -= 1.5;

      // Your shots against them.
      for (const b of s.bullets) {
        const f = s.foes.find((f) => hit(b, 2, 1, f, 7, 5));
        if (f) { b.dead = f.dead = true; s.score += 5 + f.type * 5; s.fx.push({ x: f.x + 3, y: f.y + 2, t: 0 }); s.sfx.push('boom'); continue; }
        if (bo && hit(b, 2, 1, { x: bo.x, y: bo.y }, 12, 12)) {
          b.dead = true;
          if (--bo.hp <= 0) { s.score += 100; s.fx.push({ x: bo.x + 6, y: bo.y + 6, t: 0 }); s.boss = null; s.sfx.push('win'); }
          else s.sfx.push('tick');
        }
      }
      // Them against you.
      for (const f of s.foes) if (!f.dead && hit(sh, 7, 5, f, 7, 5)) { f.dead = true; space.hurt(s); }
      for (const sht of s.shots) if (hit(sh, 7, 5, sht, 2, 1)) { sht.dead = true; space.hurt(s); }
      if (s.boss && hit(sh, 7, 5, { x: s.boss.x, y: s.boss.y }, 12, 12)) space.hurt(s);

      s.bullets = s.bullets.filter((b) => !b.dead && b.x < W);
      s.foes = s.foes.filter((f) => !f.dead && f.x > -8);
      s.shots = s.shots.filter((x) => !x.dead && x.x > -2);
      s.fx = s.fx.filter((e) => ++e.t < 8);
      if (!s.foes.length && !s.boss && !s.over) space.wave(s, rand);
    },
    draw(scr, s) {
      for (let i = 0; i < s.lives; i++) scr.sprite(HEART, 1 + i * 4, 1, 2);
      if (s.boss) { scr.frame(W - 32, 1, 31, 3); scr.rect(W - 31, 2, Math.ceil((29 * s.boss.hp) / s.boss.max), 1, 2); }
      else if (s.wave) scr.text(`WAVE ${s.wave}`, W - textWidth(`WAVE ${s.wave}`) - 1, 0);
      for (let x = 0; x < W; x += 2) scr.set(x, TOP - 1);
      for (const st of s.stars) scr.set(st.x, st.y);
      if (!s.inv || (s.inv >> 2) % 2 === 0) scr.sprite(SHIP, s.ship.x, s.ship.y);
      for (const b of s.bullets) scr.rect(b.x, b.y, 2, 1, 2);
      for (const f of s.foes) scr.sprite(FOES[f.type], f.x, f.y);
      if (s.boss) scr.sprite(BOSS, s.boss.x, s.boss.y);
      for (const sht of s.shots) scr.rect(sht.x, sht.y, 2, 1);
      for (const e of s.fx) { // a little burst that grows and scatters
        const r = 1 + (e.t >> 1);
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) scr.set(e.x + dx * r, e.y + dy * r, 2);
      }
    },
  };

  const LIST = [snake, stack, space];
  const byId = Object.fromEntries(LIST.map((g) => [g.id, g]));

  // --- Everything below touches the page, and runs only once setup() is called -------------------
  let els, ctx, img, scr, blob, opts = {};
  let colors = { bg: '#141416', ink: '#ececf1', accent: '#7c6cff' }, rgb = [];
  let game = null, state = null, mode = 'closed', before = null, pickIx = 0, doneText = '';
  let raf = 0, last = 0, acc = 0, newBest = false;
  const held = new Set();

  const STORE = 'dt-games'; // best scores and the sound switch, on this Mac only
  const load = () => { try { return { best: {}, sound: false, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { best: {}, sound: false }; } };
  const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {} };
  let store = { best: {}, sound: false };

  // Nokia beeps: short square waves, made on the spot. Off until you turn the sound on.
  let audio = null;
  const SFX = {
    eat: [[880, 0.05]], die: [[440, 0.1], [330, 0.1], [220, 0.2]], turn: [[1320, 0.015]], land: [[180, 0.03]],
    line: [[660, 0.06], [990, 0.09]], shoot: [[1500, 0.02]], boom: [[160, 0.06]], hit: [[300, 0.08], [200, 0.12]],
    tick: [[900, 0.015]], win: [[660, 0.08], [880, 0.08], [1320, 0.16]], best: [[880, 0.08], [1175, 0.08], [1760, 0.18]],
  };
  const beep = (name) => {
    if (!store.sound || !SFX[name]) return;
    try {
      audio ??= new AudioContext();
      let t = audio.currentTime;
      for (const [f, d] of SFX[name]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + d);
        t += d;
      }
    } catch {}
  };

  const hex = (c) => { const m = /^#?([\da-f]{6})/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = (c) => `rgb(${c.join(',')})`;
  function palette() {
    const bg = hex(colors.bg), ink = hex(colors.ink), acc = hex(colors.accent);
    rgb = [mix(bg, ink, 0.07), ink, acc]; // the screen is a touch lighter (or darker) than the page
    if (els) els.card.style.setProperty('--lcd', css(rgb[0]));
  }

  const paint = (canvas, g, s) => {
    const c = canvas.getContext('2d'), im = c.createImageData(W, H), sc = screen();
    g.draw(sc, s);
    for (let i = 0; i < W * H; i++) { const [r, gg, b] = rgb[sc.b[i]]; im.data.set([r, gg, b, 255], i * 4); }
    c.putImageData(im, 0, 0);
  };

  function draw() {
    if (!game || !state) { ctx.fillStyle = css(rgb[0]); ctx.fillRect(0, 0, W, H); return; }
    scr.clear();
    game.draw(scr, state);
    const d = img.data;
    for (let i = 0; i < W * H; i++) { const c = rgb[scr.b[i]]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(100, now - (last || now));
    last = now;
    if (mode !== 'play') return;
    acc += dt;
    let ms = game.tick(state);
    while (acc >= ms && mode === 'play') {
      acc -= ms;
      game.step(state, held, Math.random);
      for (const f of state.sfx.splice(0)) beep(f);
      ms = game.tick(state);
      if (state.over) over();
    }
    score();
    draw();
  }

  const score = () => {
    els.score.textContent = state ? state.score : 0;
    els.best.textContent = Math.max(store.best[game?.id] || 0, state?.score || 0);
  };

  // What the card shows on top of the screen: the picker, or a message with the blob.
  function show(m) {
    if (m === 'play') acc = 0; // no catching up on the time spent paused
    mode = m;
    const pickOn = m === 'pick';
    els.pick.hidden = !pickOn;
    els.msg.hidden = pickOn || m === 'play';
    els.name.textContent = pickOn ? 'Games' : game.name;
    els.hint.textContent = pickOn ? '← → choose · Enter play · Esc close' : game.hint;
    els.stats.hidden = pickOn;
    if (pickOn) renderPick();
    const say = {
      start: [game?.name, 'Ready when you are.', ['go', 'Start', 'Space'], ['all', 'All games']],
      paused: ['Paused', 'Take your time.', ['go', 'Keep going', 'Space'], ['all', 'All games']],
      over: [newBest ? 'New best!' : 'Game over', `You scored ${state?.score ?? 0}.`, ['go', 'Play again', 'Space'], ['all', 'All games']],
      done: [doneText, 'Back to it, or finish your game first?', ['back', 'Back to it', 'Enter'], ['keep', 'Keep playing', 'Space']],
    }[m];
    if (say) {
      els.msgTitle.textContent = say[0];
      els.msgText.textContent = say[1];
      els.msgBtns.innerHTML = say.slice(2).map(([act, label, key], i) =>
        `<button class="${i ? 'game-b2' : 'go'}" data-act="${act}">${label}${key ? ` <kbd>${key}</kbd>` : ''}</button>`).join('');
      const look = { start: ['idle', 'happy'], paused: ['sleep'], over: newBest ? ['idle', 'excited'] : ['idle', 'sad'], done: ['notify'] }[m];
      blob?.set(look[0], look[1] || null);
    }
    score();
    draw();
  }

  function renderPick() {
    els.pick.innerHTML = LIST.map((g, i) =>
      `<button class="game-tile${i === pickIx ? ' on' : ''}" data-i="${i}"><canvas width="${W}" height="${H}"></canvas>
        <b>${g.name}</b><small>Best ${store.best[g.id] || 0}</small></button>`).join('');
    // Each tile shows its game mid-play: the same seeded game every time.
    [...els.pick.querySelectorAll('canvas')].forEach((c, i) => {
      const g = LIST[i], r = seeded(7 + i), s = g.init(r);
      if (g === snake) s.body = [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }];
      if (g === stack) { for (let y = 15; y < 20; y++) for (let x = 0; x < 10; x++) s.board[y][x] = r() < 0.75 ? 1 : 0; s.piece.y = 6; }
      if (g === space) for (let k = 0; k < 70; k++) g.step(s, new Set(k % 9 === 0 ? ['fire'] : []), r);
      paint(c, g, s);
    });
  }

  function choose(id) {
    game = byId[id] || game || snake;
    pickIx = LIST.indexOf(game);
    state = null;
    show('start');
  }
  function start() {
    state = game.init(Math.random);
    newBest = false;
    held.clear(); acc = 0;
    show('play');
    opts.track?.('game_played', { game: game.id });
  }
  function over() {
    const best = store.best[game.id] || 0;
    newBest = state.score > best && state.score > 0;
    if (newBest) { store.best[game.id] = state.score; keep(); beep('best'); }
    show('over');
  }
  const pause = () => { if (mode === 'play') show('paused'); };

  function act(a) {
    if (a === 'go') return mode === 'paused' ? show('play') : start();
    if (a === 'all') return show('pick');
    if (a === 'back') return opts.onBack ? opts.onBack() : close();
    if (a === 'keep') return show(before || 'pick');
  }

  // Keys belong to the game while it has focus; ⌘ shortcuts still reach the app.
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', 8: 'up', 2: 'down', 4: 'left', 6: 'right', // 2 4 6 8: the phone's keypad
    ' ': 'fire', 5: 'fire', Enter: 'enter', p: 'pause', Escape: 'esc',
  };
  function onKey(e) {
    if (mode === 'closed' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!els.root.contains(document.activeElement)) return;
    const a = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keyup') { held.delete(a); return; }
    if (document.activeElement !== els.canvas) focus(); // a button that's about to hide mustn't take focus with it
    if (a === 'esc') return close();
    if (mode === 'pick') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') { pickIx = (pickIx + (a === 'left' || a === 'up' ? -1 : 1) + LIST.length) % LIST.length; renderPick(); }
      if (a === 'enter' || a === 'fire') { choose(LIST[pickIx].id); start(); }
      return;
    }
    if (mode === 'done') { if (a === 'enter') act('back'); if (a === 'fire') act('keep'); return; }
    if (mode !== 'play') { if (a === 'enter' || a === 'fire' || (a === 'pause' && mode === 'paused')) act('go'); return; }
    if (a === 'pause') return pause();
    if (e.repeat && game === snake) return;
    held.add(a);
    game.press(state, a, Math.random);
    for (const f of state.sfx.splice(0)) beep(f);
    if (state.over) over();
    draw();
  }

  // The screen: 84 × 48, scaled by the biggest whole number that fits, so every pixel stays square.
  function fit() {
    const w = els.root.clientWidth - 96, h = els.root.clientHeight - 170;
    const k = Math.max(2, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    els.canvas.style.width = `${W * k}px`;
    els.canvas.style.height = `${H * k}px`;
  }

  function setup(o) {
    opts = o;
    store = load();
    const $ = (id) => document.getElementById(id);
    els = {
      root: $('game'), card: $('gameCard'), canvas: $('gameCanvas'), name: $('gameName'), score: $('gameScore'), best: $('gameBest'),
      stats: $('gameStats'), sound: $('gameSound'), pick: $('gamePick'), msg: $('gameMsg'), msgTitle: $('gameMsgTitle'),
      msgText: $('gameMsgText'), msgBtns: $('gameMsgBtns'), hint: $('gameHint'),
    };
    ctx = els.canvas.getContext('2d');
    img = ctx.createImageData(W, H);
    scr = screen();
    blob = window.Blobs?.status(44);
    if (blob) { blob.el.className = 'game-blob'; $('gameBlob').replaceWith(blob.el); }
    palette();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', () => { held.clear(); pause(); });
    els.root.addEventListener('focusout', (e) => { if (!els.root.contains(e.relatedTarget)) { held.clear(); pause(); } });
    els.root.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) setTimeout(focus); });
    els.msgBtns.onclick = (e) => { const b = e.target.closest('button'); if (b) { focus(); act(b.dataset.act); } };
    els.pick.onclick = (e) => { const t = e.target.closest('.game-tile'); if (t) { focus(); choose(LIST[+t.dataset.i].id); start(); } };
    $('gameClose').onclick = () => close();
    els.sound.onclick = () => { store.sound = !store.sound; keep(); syncSound(); focus(); };
    syncSound();
    new ResizeObserver(fit).observe(els.root);
  }
  const syncSound = () => {
    els.sound.classList.toggle('on', store.sound);
    els.sound.title = store.sound ? 'Sound on' : 'Sound off';
    els.sound.setAttribute('aria-pressed', store.sound);
  };

  const focus = () => els?.canvas.focus({ preventScroll: true });
  function open(id) {
    if (!els) return;
    els.root.classList.add('open');
    if (id) choose(id);
    else if (state && !state.over) show('paused'); // carry on where you left off
    else show('pick');
    if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
    fit();
    focus();
  }
  function close() {
    if (mode === 'closed') return;
    mode = 'closed';
    cancelAnimationFrame(raf); raf = 0;
    held.clear();
    els.root.classList.remove('open');
    opts.onClose?.();
  }
  const isOpen = () => mode !== 'closed';

  // Whatever you were waiting for is done: pause and say so.
  function workDone(text) {
    if (!isOpen()) return;
    if (mode !== 'done') before = mode; // "Keep playing" goes back to exactly this
    doneText = text;
    show('done');
    beep('best');
  }

  function setColors(c) {
    colors = { ...colors, ...c };
    palette();
    if (els && isOpen()) { if (mode === 'pick') renderPick(); draw(); }
  }

  return { setup, open, close, isOpen, focus, workDone, setColors, logic: { snake, stack, space, screen, seeded, W, H } };
})();
