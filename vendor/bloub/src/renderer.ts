import { arcGradientId } from "./util";
import type { BotFrame } from "./core/engine";

const NS = "http://www.w3.org/2000/svg";
const NOTIF_COLOR = "#41D1FF";
const TEAR_UNIT = 0.118;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
};
const set = (n: Element, attrs: Record<string, string | number>) => {
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
};

let uid = 0;

/** Keeps `parent`'s children in sync with `count` pooled nodes. */
function pool<T extends { root: SVGElement }>(parent: Element, nodes: T[], count: number, make: () => T): T[] {
  while (nodes.length < count) {
    const n = make();
    nodes.push(n);
    parent.appendChild(n.root);
  }
  for (let i = 0; i < nodes.length; i++) nodes[i].root.style.display = i < count ? "" : "none";
  return nodes;
}

export interface BloubView {
  svg: SVGSVGElement;
  render(frame: BotFrame, color: string): void;
  destroy(): void;
}

/** Creates the SVG scene once; `render()` patches it in place every frame (no innerHTML churn). */
export function createBloubView(container: Element, size: number): BloubView {
  const id = `bloub-${++uid}`;
  const svg = el("svg", {
    viewBox: "-100 -100 200 200", width: size, height: size, role: "img", "aria-hidden": "true",
  });
  svg.style.overflow = "visible";
  svg.style.display = "block";

  const defs = el("defs");
  const mask = el("mask", { id: `${id}-m`, maskUnits: "userSpaceOnUse", x: -400, y: -400, width: 800, height: 800 });
  mask.appendChild(el("rect", { x: -400, y: -400, width: 800, height: 800, fill: "#fff" }));
  const notchHole = el("circle", { r: 0, fill: "#000" });
  mask.appendChild(notchHole);
  defs.appendChild(mask);

  const behind = el("g");
  const body = el("path", { mask: `url(#${id}-m)` });
  const front = el("g");
  const eyesG = el("g");
  const arcsG = el("g");
  const notifDot = el("circle", { fill: NOTIF_COLOR, r: 0 });
  svg.append(defs, behind, body, front, eyesG, arcsG, notifDot);
  container.appendChild(svg);

  type Node1 = { root: SVGGElement };
  let behindDots: Node1[] = [];
  let frontDots: Node1[] = [];
  let eyeNodes: { root: SVGPathElement }[] = [];
  let arcNodes: {
    root: SVGGElement; grad: SVGLinearGradientElement; stops: SVGStopElement[]; path: SVGPathElement;
  }[] = [];

  const renderDots = (parent: Element, nodes: Node1[], dots: BotFrame["dots"], color: string) => {
    nodes = pool(parent, nodes, dots.length, () => ({ root: el("g") }));
    dots.forEach((d, i) => {
      const g = nodes[i].root;
      // Custom-path dots (tear) are authored in unit space; circles are drawn directly.
      if (d.d) {
        if (g.childElementCount !== 1 || g.firstElementChild!.tagName !== "path") g.replaceChildren(el("path"));
        const p = g.firstElementChild!;
        set(p, { d: d.d, fill: d.color ?? color, "fill-opacity": d.opacity });
        g.setAttribute("transform", `translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${d.r / TEAR_UNIT})`);
      } else {
        if (g.childElementCount !== 1 || g.firstElementChild!.tagName !== "circle") g.replaceChildren(el("circle"));
        set(g.firstElementChild!, { cx: d.x, cy: d.y, r: d.r, fill: d.color ?? color, "fill-opacity": d.opacity });
        g.removeAttribute("transform");
      }
    });
    return nodes;
  };

  return {
    svg,
    render(frame, color) {
      set(body, { d: frame.bodyPath, fill: color, "fill-opacity": frame.bodyAlpha });
      set(notchHole, frame.notch ? { cx: frame.notch.x, cy: frame.notch.y, r: frame.notch.r } : { r: 0 });
      set(notifDot, frame.notif ? { cx: frame.notif.x, cy: frame.notif.y, r: frame.notif.r } : { r: 0 });

      behindDots = renderDots(behind, behindDots, frame.dotsBehind ? frame.dots : [], color);
      frontDots = renderDots(front, frontDots, frame.dotsBehind ? [] : frame.dots, color);

      eyeNodes = pool(eyesG, eyeNodes, frame.eyes.length, () => ({ root: el("path", { fill: "#fff" }) }));
      frame.eyes.forEach((e, i) => set(eyeNodes[i].root, { d: e.d, transform: e.matrix, "fill-opacity": e.alpha }));

      // Only the front half of each ring is drawn; the half behind the body is hidden by it.
      arcNodes = pool(arcsG, arcNodes, frame.arcs.length, () => {
        const root = el("g");
        const grad = el("linearGradient", { gradientUnits: "userSpaceOnUse" });
        const stops = [0, 0.5, 1].map((o) => el("stop", { offset: o }));
        grad.append(...stops);
        const path = el("path", { fill: "none", "stroke-linecap": "round" });
        root.append(grad, path);
        return { root, grad, stops, path };
      });
      frame.arcs.forEach((a, i) => {
        const n = arcNodes[i];
        const gid = arcGradientId(id, i);
        set(n.grad, { id: gid, x1: a.grad.x1, y1: a.grad.y1, x2: a.grad.x2, y2: a.grad.y2 });
        n.stops.forEach((s, k) => set(s, { "stop-color": a.grad.stops[k], "stop-opacity": a.opacity }));
        set(n.path, { d: a.front, stroke: `url(#${gid})`, "stroke-width": a.width });
      });
    },
    destroy() {
      svg.remove();
    },
  };
}

/** Serialises a frame to a standalone SVG, then rasterises it to a PNG (15% padding, like the Flutter export). */
export async function svgToPngBlob(frame: BotFrame, color: string, size: number): Promise<Blob> {
  const host = document.createElement("div");
  const view = createBloubView(host, size);
  view.render(frame, color);
  const pad = 200 * 0.15;
  const box = 200 + pad * 2;
  view.svg.setAttribute("viewBox", `${-100 - pad} ${-100 - pad} ${box} ${box}`);
  view.svg.setAttribute("xmlns", NS);
  const xml = new XMLSerializer().serializeToString(view.svg);
  view.destroy();

  const img = new Image();
  img.decoding = "async";
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Bloub: failed to rasterise SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
