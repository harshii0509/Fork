// Fork's own hairline figure for the New workspace card "New folder" (index.html .start-cards), drawn with the
// hairline-create kit on vendor/hairline-kernel.js. renderer.js mountFigure mounts it like a stock figure.
(() => {
"use strict";
/**
 * Folders: four file folders standing on a shelf, each holding a terminal
 * window, a card with three lights, a title bar and lines of output, peeking
 * over its front leaf by a different amount. The folder under the pointer
 * opens its front leaf and its window slides up out of it; the other windows
 * tuck down, staggered outwards from it. Each folder's tab sits at its own
 * place along the back leaf. The slider is how far the window slides.
 *
 * The pattern: one of many. Tweens, a stagger by distance, and a hit test on
 * static bands along the folders' resting tops, as Riffle's, so a window
 * sliding up cannot change the choice.
 */
const {
  Cam, clamp, facing, fillet, fit, poly, proj, rad, rings, prism, seg,
  tdone, tset, tval, tween, disposer, mk, place, pointer, put, register, solid,
} = HL;

const N = 4, W = 80, G = 26, POCK = 5, BH = 56, TW = 24, TH = 8, FH = 36, WH = 44, TK = 1.2;
const TABS = [6, 50, 28, 44], REST = [4, 12, 2, 7], LINES = [0.7, 0.45, 0.85, 0.3], HOME = 1;
const BACK = -7, FWD = 5, OPEN = 14, LMAX = 38;
const X0 = -8, X1 = W + 8, Y0 = -10, Y1 = (N - 1) * G + POCK + 12;

const backShape = (t) => fillet(
  [[0, 0], [W, 0], [W, BH], [t + TW + 3, BH], [t + TW, BH + TH], [t, BH + TH], [t - 3, BH], [0, BH]],
  [1, 1, 3, 1.5, 2, 2, 1.5, 3],
);
const frontShape = fillet(
  [[0, 0], [W, 0], [W, FH], [W / 2 + 11, FH], [W / 2 + 7, FH - 4], [W / 2 - 7, FH - 4], [W / 2 - 11, FH], [0, FH]],
  [1, 1, 3, 1.5, 2, 2, 1.5, 3],
);
const winShape = fillet([[7, 0], [W - 7, 0], [W - 7, WH], [7, WH]], [2.5, 2.5, 2.5, 2.5]);

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let lift = value, act = -1;

  // Fitted to the shelf with the farthest window slid all the way out, so nothing leaves the frame.
  const C = Cam(45, 0.5, 1.65);
  fit(C, [[X0, Y0, -7], [X1, Y1, -7], [X1, Y0, -7], [X0, Y1, -7], [7, POCK / 2, LMAX + WH], [W - 7, POCK / 2, LMAX + WH]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);
  const [sr, si] = rings(X0, Y0, X1, Y1, 8, 2.2);
  put(solid(g), prism(P, front, sr, si, -7, 0));

  /** A leaf or a card in its own plane at y0, leaning th degrees (negative leans back) and raised by z: its face, and its back a thickness behind. */
  const plane = (y0, th, z) => {
    const s = Math.sin(rad(th)), c = Math.cos(rad(th));
    return {
      w: (u, v) => P(u, y0 + v * s, v * c + z),
      wb: (u, v) => P(u, y0 + v * s - TK * c, v * c + TK * s + z),
    };
  };
  const leaf = (grp) => ({ back: mk("path", { class: "lo" }, grp), face: mk("path", { class: "sil" }, grp) });

  const folders = TABS.map((t, i) => {
    const grp = mk("g", {}, g), bl = leaf(grp), win = leaf(grp);
    const title = mk("path", { class: "nf lo" }, grp), lines = mk("path", { class: "nf lo" }, grp);
    const prompt = mk("path", { class: "nf" }, grp);
    const lights = [0, 1, 2].map((k) => mk("circle", { r: 0.95, class: k === 0 ? "dot m" : "dot off" }, grp));
    const fl = leaf(grp);
    const yb = i * G, b = plane(yb, BACK, 0), sb = backShape(t);
    bl.back.setAttribute("d", poly(sb.map((p) => b.wb(...p))));
    bl.face.setAttribute("d", poly(sb.map((p) => b.w(...p))));
    win.face.classList.toggle("hi", i === HOME);
    return { yb, bl, win, title, lines, prompt, lights, fl, z: tween(REST[i]), th: tween(FWD), drawn: "" };
  });

  function draw(f, i, now) {
    const z = tval(f.z, now), th = tval(f.th, now), key = z + "|" + th;
    if (key === f.drawn) return;
    f.drawn = key;
    const wp = plane(f.yb + POCK / 2, 0, z), fp = plane(f.yb + POCK, th, 0);
    f.win.back.setAttribute("d", poly(winShape.map((p) => wp.wb(...p))));
    f.win.face.setAttribute("d", poly(winShape.map((p) => wp.w(...p))));
    f.title.setAttribute("d", seg(wp.w(7, WH - 8), wp.w(W - 7, WH - 8)));
    f.lines.setAttribute("d", LINES.map((_, k) => seg(wp.w(12, WH - 14 - k * 5), wp.w(12 + (W - 24) * LINES[(k + i) % 4], WH - 14 - k * 5))).join(""));
    f.prompt.setAttribute("d", seg(wp.w(12, WH - 36), wp.w(20, WH - 36)));
    f.lights.forEach((el, k) => place(el, wp.w(12 + k * 3.6, WH - 4)));
    f.fl.back.setAttribute("d", poly(frontShape.map((p) => fp.wb(...p))));
    f.fl.face.setAttribute("d", poly(frontShape.map((p) => fp.w(...p))));
  }

  const B = register(stage, (_dt, now) => {
    let moving = false;
    folders.forEach((f, i) => { draw(f, i, now); if (!tdone(f.z, now) || !tdone(f.th, now)) moving = true; });
    return moving;
  });
  bag.add(B.unregister);

  // Hit bands: oblique strips along the RESTING tops of the front leaves. They never move, and nothing draws them.
  const top = (i) => P(W / 2, i * G + POCK, FH);
  const c0 = top(0), c1 = top(1), d = [c1[0] - c0[0], c1[1] - c0[1]];
  const px0 = P(0, 0, 0), px1 = P(1, 0, 0), ex = [px1[0] - px0[0], px1[1] - px0[1]];
  const HALF = W / 2 + 6, det = d[0] * ex[1] - d[1] * ex[0];

  /** The folder whose band holds the point, in the band's own (s, r) coordinates; -1 outside. */
  function hit([x, y]) {
    const qx = x - c0[0], qy = y - c0[1];
    const s = (qx * ex[1] - qy * ex[0]) / det, r = (d[0] * qy - d[1] * qx) / det;
    if (Math.abs(r) > HALF || s < -1.2 || s > N + 0.5) return -1;
    return clamp(Math.round(s), 0, N - 1);
  }

  /** Pulls folder a's window out (-1 puts them back). The stagger spreads out from the folder chosen, or the one let go. */
  function setActive(a, force) {
    if (a === act && !force) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    folders.forEach((f, i) => {
      const delay = Math.abs(i - from) * 45;
      tset(f.z, a < 0 ? REST[i] : i === a ? lift : 0, now, delay);
      tset(f.th, i === a ? OPEN : FWD, now, delay);
      f.win.face.classList.toggle("hi", i === (a < 0 ? HOME : a));
    });
    read.textContent = a < 0 ? "rest" : "folder " + (a + 1);
    B.wake();
  }

  read.textContent = "rest";
  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { lift = v; if (act >= 0) setActive(act, true); },
    destroy: bag.dispose,
  };
}

(window.FIGURES ||= {}).folders = {
  name: "folders",
  means: "Four folders on a shelf, each holding a terminal: the one under the pointer opens and its window slides up.",
  rules: [1, 2, 5, 6],
  range: [22, 30, 38],
  tour: [[244, 138], [183, 169], [153, 184], null],
  mount,
};
})();
