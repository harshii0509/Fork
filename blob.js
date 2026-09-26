// The Bloub mascot, drawn as pixel art, as a "working on it" indicator. Each blob only animates
// between start() and stop(), so a hidden one costs nothing. Needs vendor/bloub/bloub.js (the `Bloub` global) first.
window.Blobs = (() => {
  const all = [];
  let color = '#7c6cff', bad = '#e5484d';
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  // `state` plays while running; between runs it rests as idle, so each start() morphs into it.
  const mount = (el, { size, state = 'thinking', expression = null }) => {
    const ctrl = new Bloub.BloubController({ color, expression });
    const view = Bloub.createPixelView(el, size);
    const draw = () => view.render(ctrl.sample(), ctrl.paint);
    let raf = 0;
    const tick = () => { draw(); raf = requestAnimationFrame(tick); };
    const blob = {
      ctrl,
      start() {
        if (raf) return;
        ctrl.setState(state);
        // Reduced motion: skip the morph and hold one frame of the state.
        if (still.matches) { setTimeout(draw, 450); draw(); return; }
        tick();
      },
      stop() {
        cancelAnimationFrame(raf); raf = 0;
        ctrl.setState('idle');
      },
    };
    draw();
    all.push(blob);
    return blob;
  };

  // Status blobs (one per sidebar tab) are always alive, so they share one frame loop, which
  // runs only while any exist and skips the ones on screen nowhere (sidebar hidden, Settings open).
  const live = new Set();
  let loop = 0;
  const frame = () => {
    for (const b of live) if (b.el.offsetParent) b.draw();
    loop = live.size ? requestAnimationFrame(frame) : 0;
  };

  // `tint` is 'accent' or 'bad'; the blob follows theme changes in that colour.
  const status = (size) => {
    const el = document.createElement('span');
    const ctrl = new Bloub.BloubController({ color });
    const view = Bloub.createPixelView(el, size);
    const blob = {
      el, ctrl, tint: 'accent',
      draw: () => view.render(ctrl.sample(), ctrl.paint),
      set(state, expression = null, tint = 'accent') {
        blob.tint = tint;
        ctrl.setColor(tint === 'bad' ? bad : color);
        ctrl.setState(state);
        ctrl.setExpression(expression);
        // Reduced motion: no loop, just the new pose once the morph has settled.
        if (still.matches) { blob.draw(); setTimeout(blob.draw, 450); }
      },
      destroy() {
        live.delete(blob);
        all.splice(all.indexOf(blob), 1);
        view.destroy();
      },
    };
    blob.draw();
    all.push(blob);
    live.add(blob);
    if (!still.matches && !loop) loop = requestAnimationFrame(frame);
    return blob;
  };

  const setColor = (hex, red = bad) => {
    color = hex; bad = red;
    for (const b of all) b.ctrl.setColor(b.tint === 'bad' ? bad : hex);
  };

  return { mount, status, setColor };
})();
