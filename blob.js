// The Bloub mascot as a "working on it" indicator. Each blob only animates between start() and
// stop(), so a hidden one costs nothing. Needs vendor/bloub/bloub.js (the `Bloub` global) first.
window.Blobs = (() => {
  const all = [];
  let color = '#7c6cff';
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  // `state` plays while running; between runs it rests as idle, so each start() morphs into it.
  const mount = (el, { size, state = 'thinking', expression = null }) => {
    const ctrl = new Bloub.BloubController({ color, expression });
    const view = Bloub.createBloubView(el, size);
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

  const setColor = (hex) => { color = hex; for (const b of all) b.ctrl.setColor(hex); };

  return { mount, setColor };
})();
