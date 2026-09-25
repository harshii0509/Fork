// Text helpers for the preview panel and drag-to-terminal. Pure functions, no DOM: check.mjs tests them.
window.Preview = (() => {
  // Colours, cursor moves, titles and hyperlinks: everything that isn't visible text.
  const stripAnsi = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, '');

  // The last local web address in some terminal output, e.g. a dev server's "Local: http://localhost:3000".
  const findLocalUrl = (text) => {
    const re = /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s"'`<>)\]]*)?/g;
    let m, last = null;
    while ((m = re.exec(text))) last = m;
    if (!last) return null;
    const host = /^(0\.0\.0\.0|\[::\])$/.test(last[1]) ? 'localhost' : last[1]; // "listening on all" isn't browsable
    const path = (last[3] || '/').replace(/[.,;:]+$/, '');
    return `http://${host}:${last[2]}${path}`;
  };

  // Paths as macOS Terminal types them on a drop, the form Claude Code expects. Ends in a space.
  const dropText = (paths) => paths.map((p) => p.replace(/([ !"#$&'()*;<>?[\\\]^`{|}~])/g, '\\$1')).join(' ') + ' ';

  return { stripAnsi, findLocalUrl, dropText };
})();
