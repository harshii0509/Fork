// Split-pane tree for one tab. A node is a pane `{ id }` or a split `{ dir: 'row'|'col', a, b }`.
// Pure functions, no DOM: renderer.js draws the tree, check.mjs tests it.
window.Panes = (() => {
  const split = (node, targetId, newId, dir) =>
    node.id === targetId ? { dir, a: node, b: { id: newId } }
      : node.dir ? { ...node, a: split(node.a, targetId, newId, dir), b: split(node.b, targetId, newId, dir) }
        : node;

  // Remove a pane; its sibling takes the parent's place. Returns null when the tree is empty.
  const remove = (node, id) => {
    if (node.id === id) return null;
    if (!node.dir) return node;
    const a = remove(node.a, id), b = remove(node.b, id);
    return !a ? b : !b ? a : { ...node, a, b };
  };

  const leaves = (node) => (node.dir ? [...leaves(node.a), ...leaves(node.b)] : [node.id]);

  // Nearest pane in an arrow's direction, from on-screen rects { id: {x, y, w, h} }.
  const neighbor = (rects, fromId, arrow) => {
    const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const from = c(rects[fromId]);
    const ahead = { ArrowLeft: (p) => p.x < from.x - 1, ArrowRight: (p) => p.x > from.x + 1,
      ArrowUp: (p) => p.y < from.y - 1, ArrowDown: (p) => p.y > from.y + 1 }[arrow];
    let best = null, bestD = Infinity;
    for (const [id, r] of Object.entries(rects)) {
      const p = c(r);
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (id !== String(fromId) && ahead(p) && d < bestD) { best = id; bestD = d; }
    }
    return best;
  };

  return { split, remove, leaves, neighbor };
})();
