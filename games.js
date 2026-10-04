// Little Nokia-style games for while Claude works (or whenever): Snake, Stack and Space Run.
// A game lives in its own pane, like a terminal, and fills it: small square pixels (sized from the
// terminal font) in the theme's colours, as many as fit, the way text fills a terminal.
// The rules are plain functions of a game's state (check.mjs tests them). setup() builds the pane's
// contents (Games.el) and wires keys, beeps and best scores; renderer.js puts it in a pane.
window.Games = (() => {
  const W = 84, H = 48; // the smallest world, and the picker's little previews: a Nokia 3310's screen

  // --- The screen: 0 = off, 1 = ink (theme text), 2 = accent -------------------------------------
  // A 3 × 5 pixel font for the few words and numbers drawn on the screen itself.
  const FONT = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111101101101', N: '101111111111101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101101111111', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', '!': '010010010000010', ' ': '000000000000000',
  };
  const screen = (w = W, h = H) => {
    const b = new Uint8Array(w * h);
    const set = (x, y, c = 1) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < w && y < h) b[y * w + x] = c; };
    const rect = (x, y, w, h, c = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    return {
      w, h, b, set, rect,
      clear: () => b.fill(0),
      frame: (x, y, w, h, c = 1) => { rect(x, y, w, 1, c); rect(x, y + h - 1, w, 1, c); rect(x, y, 1, h, c); rect(x + w - 1, y, 1, h, c); },
      // Sprites are rows of '#' (on) and '.' (off).
      sprite: (rows, x, y, c = 1) => rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') set(x + i, y + j, c); }),
      text: (str, x, y, c = 1, k = 1) => { // k: each font pixel as a k × k block, for bigger panes
        for (const ch of String(str).toUpperCase()) {
          const g = FONT[ch] || FONT[' '];
          for (let i = 0; i < 15; i++) if (g[i] === '1') rect(x + (i % 3) * k, y + ((i / 3) | 0) * k, k, k, c);
          x += 4 * k;
        }
      },
    };
  };
  const textWidth = (s, k = 1) => (String(s).length * 4 - 1) * k;

  // A seeded random, so check.mjs (and the picker's little previews) get the same game every time.
  const seeded = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (rand, n) => Math.floor(rand() * n);

  // --- Snake: eat, grow, don't hit the wall or yourself ------------------------------------------
  // A grid of cells inside a border (20 × 11 on the smallest screen). Cells are 4 pixels, growing to 6 in a
  // big pane so the field stays about 30 across. Each part of the snake fills its cell but for a
  // 1-pixel gap, joined to the next, so it reads as one body like on the phone.
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const snake = {
    id: 'snake', name: 'Snake', hint: '↑ ↓ ← → turn · P pause',
    init(rand, w = W, h = H) {
      const p = Math.max(4, Math.min(6, Math.floor(Math.min((w - 3) / 30, (h - 3) / 18))));
      const cols = Math.floor((w - 3) / p), rows = Math.floor((h - 3) / p), y = rows >> 1;
      const s = { p, cols, rows, body: [7, 6, 5, 4].map((x) => ({ x, y })), dir: 'right', queue: [], score: 0, eaten: 0, over: false, sfx: [] };
      s.food = snake.food(s, rand);
      return s;
    },
    food(s, rand) {
      const free = [];
      for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (!s.body.some((p) => p.x === x && p.y === y)) free.push({ x, y });
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
      if (n.x < 0 || n.y < 0 || n.x >= s.cols || n.y >= s.rows || rest.some((p) => p.x === n.x && p.y === n.y)) {
        s.over = true; s.sfx.push('die'); return;
      }
      s.body = [n, ...rest];
      if (eat) { s.score += 1; s.eaten += 1; s.food = snake.food(s, rand); s.sfx.push('eat'); }
    },
    draw(scr, s) {
      scr.frame(0, 0, scr.w, scr.h);
      const P = s.p, n = P - 1; // cell pitch, and the size of a part
      const ox = (scr.w - (s.cols * P - 1)) >> 1, oy = (scr.h - (s.rows * P - 1)) >> 1; // the grid sits in the middle
      const at = (p) => [ox + p.x * P, oy + p.y * P];
      s.body.forEach((p, i) => {
        const [x, y] = at(p);
        scr.rect(x, y, n, n);
        const q = s.body[i + 1]; // fill the gap to the next part
        if (q) { const [qx, qy] = at(q); scr.rect(Math.min(x, qx) + (qx !== x ? n : 0), Math.min(y, qy) + (qy !== y ? n : 0), qx !== x ? 1 : n, qy !== y ? 1 : n); }
      });
      if (s.food) { // a small diamond
        const [x, y] = at(s.food), m = n >> 1;
        for (let j = 0; j < n; j++) { const r = m - Math.abs(j - m); scr.rect(x + m - r, y + j, 2 * r + 1, 1, 2); }
        if (n === 3) scr.set(x + 1, y + 1, 0); // on the smallest grid, the Nokia's hollow diamond
      }
    },
  };

  // --- Stack: falling blocks, clear full lines ----------------------------------------------------
  // A 10 × 20 well in the middle, its blocks as big as the height allows; lines and level on the left,
  // the next piece on the right.
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
      const c = Math.max(2, Math.min(5, Math.floor((scr.h - 6) / stack.ROWS))), k = 1; // blocks grow a little with the pane, not a lot
      const X = (scr.w - stack.COLS * c) >> 1, Y = (scr.h - stack.ROWS * c) >> 1;
      scr.frame(X - 2, Y - 2, stack.COLS * c + 4, stack.ROWS * c + 4);
      const block = (x, y, col) => scr.rect(X + x * c, Y + y * c, c - (c > 3 ? 1 : 0), c - (c > 3 ? 1 : 0), col); // a hairline gap once blocks are big
      s.board.forEach((row, y) => row.forEach((on, x) => on && block(x, y, 1)));
      if (!s.over) for (const [cx, cy] of s.piece.cells) if (s.piece.y + cy >= 0) block(s.piece.x + cx, s.piece.y + cy, 2);
      const L = X - 6 * k; // labels end just left of the well
      scr.text('LINES', L - textWidth('LINES', k), Y, 1, k); scr.text(s.lines, L - textWidth(s.lines, k), Y + 7 * k, 2, k);
      scr.text('LEVEL', L - textWidth('LEVEL', k), Y + 19 * k, 1, k); scr.text(s.level, L - textWidth(s.level, k), Y + 26 * k, 2, k);
      const R = X + stack.COLS * c + 6 * k, n = Math.max(2, Math.round(c * 0.75));
      scr.text('NEXT', R, Y, 1, k);
      for (const [cx, cy] of PIECES[s.next]) scr.rect(R + cx * n, Y + 8 * k + cy * n, n, n);
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
    id: 'space', name: 'Space Run', hint: '↑ ↓ fly · Space shoot (hold it) · P pause',
    init(rand, w = W, h = H) {
      return {
        w, h, ship: { x: 2, y: h >> 1 }, bullets: [], foes: [], shots: [], fx: [], boss: null,
        stars: Array.from({ length: Math.round((w * h) / 330) }, () => ({ x: pick(rand, w), y: TOP + pick(rand, h - TOP) })),
        lives: 3, score: 0, wave: 0, t: 0, inv: 0, cool: 0, fire: false, over: false, sfx: [],
      };
    },
    press(s, a) { if (a === 'fire') s.fire = true; },
    tick: () => 33,
    wave(s, rand) {
      s.wave++;
      if (s.wave % 5 === 0) { s.boss = { x: s.w + 2, y: s.h >> 1, dy: 1, hp: 16 + s.wave * 2, max: 16 + s.wave * 2 }; return; }
      const n = 3 + Math.min(s.wave, 6) + Math.floor((s.h - H) / 24); // a taller sky, a few more of them
      for (let i = 0; i < n; i++) {
        const type = Math.min(pick(rand, 1 + Math.min(s.wave, 3)), 2);
        const y = TOP + 2 + pick(rand, s.h - TOP - 9);
        s.foes.push({ x: s.w + i * 13, y, base: y, type, ph: rand() * 6.28, speed: 0.5 + Math.min(s.wave, 8) * 0.06 });
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
      for (const st of s.stars) if (s.t % 2 === 0 && --st.x < 0) { st.x = s.w - 1; st.y = TOP + pick(rand, s.h - TOP); }
      const sh = s.ship;
      sh.y = Math.max(TOP, Math.min(s.h - 5, sh.y + (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)));
      if (s.cool > 0) s.cool--;
      if ((s.fire || held.has('fire')) && !s.cool) { s.bullets.push({ x: sh.x + 7, y: sh.y + 2 }); s.cool = 6; s.sfx.push('shoot'); }
      s.fire = false;
      if (s.inv) s.inv--;

      for (const b of s.bullets) b.x += 3;
      for (const f of s.foes) {
        f.x -= f.speed;
        if (f.type === 1) f.y = Math.round(f.base + 4 * Math.sin(s.t / 9 + f.ph));
        if (f.type === 2 && f.x < s.w - 8 && pick(rand, 90) === 0) s.shots.push({ x: f.x - 1, y: f.y + 2 });
      }
      const bo = s.boss;
      if (bo) {
        if (bo.x > s.w - 14) bo.x -= 0.5;
        bo.y += bo.dy * 0.5;
        if (bo.y < TOP + 1 || bo.y > s.h - 13) bo.dy *= -1;
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

      s.bullets = s.bullets.filter((b) => !b.dead && b.x < s.w);
      s.foes = s.foes.filter((f) => !f.dead && f.x > -8);
      s.shots = s.shots.filter((x) => !x.dead && x.x > -2);
      s.fx = s.fx.filter((e) => ++e.t < 8);
      if (!s.foes.length && !s.boss && !s.over) space.wave(s, rand);
    },
    draw(scr, s) {
      for (let i = 0; i < s.lives; i++) scr.sprite(HEART, 1 + i * 4, 1, 2);
      if (s.boss) { scr.frame(s.w - 32, 1, 31, 3); scr.rect(s.w - 31, 2, Math.ceil((29 * s.boss.hp) / s.boss.max), 1, 2); }
      else if (s.wave) scr.text(`WAVE ${s.wave}`, s.w - textWidth(`WAVE ${s.wave}`) - 1, 0);
      for (let x = 0; x < s.w; x += 2) scr.set(x, TOP - 1);
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
  let els, ctx, img, scr, opts = {};
  let colors = { bg: '#141416', ink: '#ececf1', accent: '#f8f8f7', fontSize: 13 }, rgb = [];
  let game = null, state = null, mode = 'closed', before = null, pickIx = 0, doneText = '';
  let raf = 0, last = 0, acc = 0, newBest = false;
  let px = 3, world = { w: W, h: H }, dims = null; // pixel size, what fits the pane now, what the current game was started at
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
  const palette = () => { rgb = [hex(colors.bg), hex(colors.ink), hex(colors.accent)]; }; // off = the terminal's own background

  const blit = (c, im, sc) => {
    const d = im.data;
    for (let i = 0; i < sc.w * sc.h; i++) { const p = rgb[sc.b[i]]; d[i * 4] = p[0]; d[i * 4 + 1] = p[1]; d[i * 4 + 2] = p[2]; d[i * 4 + 3] = 255; }
    c.putImageData(im, 0, 0);
  };
  const paint = (canvas, g, s) => { const c = canvas.getContext('2d'), sc = screen(); g.draw(sc, s); blit(c, c.createImageData(W, H), sc); };

  // The canvas is the game's world, one canvas pixel per game pixel, shown px times bigger.
  function sizeCanvas() {
    const { w, h } = dims || world;
    if (els.canvas.width !== w || els.canvas.height !== h) {
      els.canvas.width = w; els.canvas.height = h;
      img = ctx.createImageData(w, h);
      scr = screen(w, h);
    }
    els.canvas.style.width = `${w * px}px`;
    els.canvas.style.height = `${h * px}px`;
  }
  function draw() {
    if (!els) return;
    sizeCanvas();
    scr.clear();
    if (game && state) game.draw(scr, state);
    blit(ctx, img, scr);
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
    status();
    draw();
  }

  // The status line along the bottom, like a terminal's: the game, the score, and what the keys do.
  const status = () => {
    const pickOn = mode === 'pick';
    els.name.textContent = pickOn ? 'Games' : game?.name ?? 'Games';
    els.stats.hidden = pickOn || !game;
    els.score.textContent = state ? state.score : 0;
    els.best.textContent = Math.max(store.best[game?.id] || 0, state?.score || 0);
    els.hint.textContent = (pickOn ? '← → choose · Enter play' : game?.hint ?? '') + ' · Esc back to the terminal · ⌘W close';
  };

  // What shows over the game: the picker, or a message.
  function show(m) {
    if (m === 'play') acc = 0; // no catching up on the time spent paused
    mode = m;
    const pickOn = m === 'pick';
    els.pick.hidden = !pickOn;
    els.msg.hidden = pickOn || m === 'play';
    if (pickOn) renderPick();
    const say = {
      start: [game?.name, 'Ready when you are.', ['go', 'Start', 'Space'], ['all', 'All games', 'G']],
      paused: ['Paused', 'Take your time.', ['go', 'Keep going', 'Space'], ['all', 'All games', 'G']],
      over: [newBest ? 'New best!' : 'Game over', `You scored ${state?.score ?? 0}.`, ['go', 'Play again', 'Space'], ['all', 'All games', 'G']],
      done: [doneText, 'Back to it, or finish your game first?', ['back', 'Back to it', 'Enter'], ['keep', 'Keep playing', 'Space']],
    }[m];
    if (say) {
      els.msgTitle.textContent = say[0];
      els.msgText.textContent = say[1];
      els.msgBtns.innerHTML = say.slice(2).map(([act, label, key]) => `<button data-act="${act}"><kbd>${key}</kbd>${label}</button>`).join('');
    }
    status();
    draw();
  }

  function renderPick() {
    els.pick.innerHTML = LIST.map((g, i) =>
      `<button class="game-tile${i === pickIx ? ' on' : ''}" data-i="${i}"><canvas width="${W}" height="${H}"></canvas>
        <b>${g.name}</b><small>best ${store.best[g.id] || 0}</small></button>`).join('');
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
    state = null; dims = null;
    show('start');
  }
  function start() {
    dims = { ...world }; // the field keeps this size for the whole game, even if the pane changes
    state = game.init(Math.random, dims.w, dims.h);
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
    if (a === 'all') { state = null; dims = null; return show('pick'); }
    if (a === 'back') { show(before === 'play' ? 'paused' : before || 'pick'); return opts.onBack?.(); }
    if (a === 'keep') return show(before || 'pick');
  }

  // Keys belong to the game while it has focus; ⌘ shortcuts (⌘W, ⌘⌥ arrows…) still reach the app.
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', 8: 'up', 2: 'down', 4: 'left', 6: 'right', // 2 4 6 8: the phone's keypad
    ' ': 'fire', 5: 'fire', Enter: 'enter', p: 'pause', g: 'games', Escape: 'esc',
  };
  function onKey(e) {
    if (mode === 'closed' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!els.root.contains(document.activeElement)) return;
    const a = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keyup') { held.delete(a); return; }
    if (document.activeElement !== els.canvas) focus(); // a button that's about to hide mustn't take focus with it
    if (a === 'esc') { pause(); return opts.onEsc?.(); }
    if (mode === 'pick') {
      if (a === 'left' || a === 'right' || a === 'up' || a === 'down') { pickIx = (pickIx + (a === 'left' || a === 'up' ? -1 : 1) + LIST.length) % LIST.length; renderPick(); }
      if (a === 'enter' || a === 'fire') { choose(LIST[pickIx].id); start(); }
      return;
    }
    if (mode === 'done') { if (a === 'enter') act('back'); if (a === 'fire') act('keep'); return; }
    if (mode !== 'play') {
      if (a === 'enter' || a === 'fire' || (a === 'pause' && mode === 'paused')) act('go');
      if (a === 'games') act('all');
      return;
    }
    if (a === 'pause') return pause();
    if (e.repeat && game === snake) return;
    held.add(a);
    game.press(state, a, Math.random);
    for (const f of state.sfx.splice(0)) beep(f);
    if (state.over) over();
    draw();
  }

  // Pixels follow the terminal font (3px at 13px); the world is as many of them as fit the pane.
  function fit() {
    px = Math.max(2, Math.round(colors.fontSize / 4.5));
    const r = els.stage.getBoundingClientRect();
    if (!r.width) return; // not on screen
    world = { w: Math.max(W, Math.floor((r.width - 16) / px)), h: Math.max(H, Math.floor((r.height - 16) / px)) };
    draw();
  }

  function setup(o) {
    opts = o;
    store = load();
    const root = document.createElement('div');
    root.className = 'game-in';
    root.innerHTML = `
      <div class="game-stage"><canvas width="${W}" height="${H}" tabindex="0" aria-label="Game"></canvas></div>
      <div class="game-pick" hidden></div>
      <div class="game-msg" hidden><h2></h2><p></p><div class="game-btns"></div></div>
      <div class="game-status"><b></b><span class="game-stats">score <b>0</b>  best <b>0</b></span><span class="game-hint"></span>
        <button class="game-sound" aria-label="Sound">${window.icon?.('volume-x') ?? ''}${window.icon?.('volume-2') ?? ''}</button></div>`;
    const q = (sel) => root.querySelector(sel);
    els = {
      root, stage: q('.game-stage'), canvas: q('canvas'), pick: q('.game-pick'), msg: q('.game-msg'),
      msgTitle: q('.game-msg h2'), msgText: q('.game-msg p'), msgBtns: q('.game-btns'),
      name: q('.game-status > b'), stats: q('.game-stats'), score: q('.game-stats b'), best: q('.game-stats b:last-child'),
      hint: q('.game-hint'), sound: q('.game-sound'),
    };
    ctx = els.canvas.getContext('2d');
    img = ctx.createImageData(W, H);
    scr = screen();
    palette();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', () => { held.clear(); pause(); });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { held.clear(); pause(); } });
    root.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) setTimeout(focus); });
    els.msgBtns.onclick = (e) => { const b = e.target.closest('button'); if (b) { focus(); act(b.dataset.act); } };
    els.pick.onclick = (e) => { const t = e.target.closest('.game-tile'); if (t) { focus(); choose(LIST[+t.dataset.i].id); start(); } };
    els.sound.onclick = () => { store.sound = !store.sound; keep(); syncSound(); focus(); };
    syncSound();
    new ResizeObserver(fit).observe(els.stage);
    api.el = root;
  }
  const syncSound = () => {
    els.sound.classList.toggle('on', store.sound);
    els.sound.title = store.sound ? 'Sound on' : 'Sound off';
    els.sound.setAttribute('aria-pressed', store.sound);
  };

  const focus = () => els?.canvas.focus({ preventScroll: true });
  // Show the game (in its pane): a chosen game waits at its start line; otherwise carry on, or pick one.
  function open(id) {
    if (!els) return;
    if (id) choose(id);
    else if (!isOpen()) state && !state.over ? show('paused') : show('pick');
    if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
    fit();
    focus();
  }
  // The pane closed: stop, and start fresh next time.
  function close() {
    if (mode === 'closed') return;
    mode = 'closed';
    cancelAnimationFrame(raf); raf = 0;
    held.clear();
    state = null; dims = null;
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
    if (els && isOpen()) { fit(); if (mode === 'pick') renderPick(); }
  }

  const api = { el: null, setup, open, close, isOpen, focus, workDone, setColors, logic: { snake, stack, space, screen, seeded, W, H } };
  return api;
})();
