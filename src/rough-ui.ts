import rough from "roughjs"
import type { RoughSVG } from "roughjs/bin/svg"

/**
 * Hand-drawn borders, drawn with RoughJS so every outline is a genuinely
 * sketched line — real pen-like wobble and per-element variation, not a
 * simulated one. Each target element gets its own inline SVG overlay sized to
 * it and redrawn on resize; the seed is derived from the element so a given box
 * always sketches the same way (stable, not flickering) while different boxes
 * sketch differently.
 *
 * The overlay is pointer-events:none and sits above the paper fill but below the
 * content, so it never affects layout, hit-testing, or the text.
 */

const SVG_NS = "http://www.w3.org/2000/svg"
const INK = "#241a10"

export interface RoughBorderOptions {
  /** 0 = crisp, 3 = very sketchy. */
  roughness?: number
  /** Line curvature; higher bows the strokes more. */
  bowing?: number
  strokeWidth?: number
  stroke?: string
  /** Inset of the drawn rectangle from the element edge, px. */
  inset?: number
  /** Double-stroke the outline for a more deliberate, inked line. */
  double?: boolean
  /** Corner radius so the sketch follows the element's informal (PaperCSS) shape. */
  radius?: number
  seed?: number
}

type Corner = readonly [number, number]

/** Rounded-rect path with per-corner elliptical radii, so the sketch follows
    the element's actual (PaperCSS) shape rather than a mismatched uniform box. */
export function roundedRectPath(x: number, y: number, w: number, h: number, tl: Corner, tr: Corner, br: Corner, bl: Corner): string {
  const cx = (rx: number) => Math.max(0, Math.min(rx, w / 2))
  const cy = (ry: number) => Math.max(0, Math.min(ry, h / 2))
  const TL: Corner = [cx(tl[0]), cy(tl[1])], TR: Corner = [cx(tr[0]), cy(tr[1])]
  const BR: Corner = [cx(br[0]), cy(br[1])], BL: Corner = [cx(bl[0]), cy(bl[1])]
  return [
    `M${x + TL[0]},${y}`,
    `H${x + w - TR[0]}`, `A${TR[0]},${TR[1]} 0 0 1 ${x + w},${y + TR[1]}`,
    `V${y + h - BR[1]}`, `A${BR[0]},${BR[1]} 0 0 1 ${x + w - BR[0]},${y + h}`,
    `H${x + BL[0]}`, `A${BL[0]},${BL[1]} 0 0 1 ${x},${y + h - BL[1]}`,
    `V${y + TL[1]}`, `A${TL[0]},${TL[1]} 0 0 1 ${x + TL[0]},${y}`,
    "Z",
  ].join(" ")
}

function parseCorner(value: string, inset: number): Corner {
  const parts = value.split(" ").map((v) => parseFloat(v) || 0)
  const rx = parts[0] ?? 0
  const ry = parts[1] ?? rx
  return [Math.max(0, rx - inset), Math.max(0, ry - inset)]
}

export function hashSeed(key: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % 65535) + 1
}

interface Bound {
  el: HTMLElement
  svg: SVGSVGElement
  rc: RoughSVG
  opts: Required<Omit<RoughBorderOptions, "seed">> & { seed: number }
  lastKey: string
}

const observed = new WeakSet<HTMLElement>()

function draw(bound: Bound): void {
  const rect = bound.el.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  const key = `${w}x${h}`
  if (key === bound.lastKey) return
  bound.lastKey = key
  bound.svg.setAttribute("viewBox", `0 0 ${w} ${h}`)
  bound.svg.setAttribute("width", String(w))
  bound.svg.setAttribute("height", String(h))
  while (bound.svg.firstChild) bound.svg.removeChild(bound.svg.firstChild)
  const { inset, roughness, bowing, stroke, strokeWidth, seed, double } = bound.opts
  const cs = getComputedStyle(bound.el)
  const tl = parseCorner(cs.borderTopLeftRadius, inset)
  const tr = parseCorner(cs.borderTopRightRadius, inset)
  const br = parseCorner(cs.borderBottomRightRadius, inset)
  const bl = parseCorner(cs.borderBottomLeftRadius, inset)
  const d = roundedRectPath(inset, inset, w - inset * 2, h - inset * 2, tl, tr, br, bl)
  const node = bound.rc.path(d, { roughness, bowing, stroke, strokeWidth, fill: "none", seed })
  bound.svg.appendChild(node)
  if (double) {
    const node2 = bound.rc.path(d, { roughness: roughness * 0.8, bowing, stroke, strokeWidth: strokeWidth * 0.7, fill: "none", seed: seed + 7 })
    node2.setAttribute("opacity", "0.5")
    bound.svg.appendChild(node2)
  }
}

/** Give one element a sketched border overlay. Idempotent per element. */
export function roughBorder(el: HTMLElement, options: RoughBorderOptions = {}): void {
  if (observed.has(el)) return
  observed.add(el)
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("class", "rough-frame")
  svg.setAttribute("preserveAspectRatio", "none")
  svg.setAttribute("aria-hidden", "true")
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0"
  const style = getComputedStyle(el)
  if (style.position === "static") el.style.position = "relative"
  el.prepend(svg)
  const opts = {
    roughness: options.roughness ?? 2.1,
    bowing: options.bowing ?? 1.4,
    strokeWidth: options.strokeWidth ?? 2.2,
    stroke: options.stroke ?? INK,
    inset: options.inset ?? 5,
    double: options.double ?? false,
    radius: options.radius ?? 14,
    seed: options.seed ?? hashSeed((el.id || el.className || "x") + el.offsetTop),
  }
  const bound: Bound = { el, svg, rc: rough.svg(svg), opts, lastKey: "" }
  draw(bound)
  const observer = new ResizeObserver(() => draw(bound))
  observer.observe(el)
}

/** Apply sketched borders to every current match of a selector. */
export function roughBorderAll(selector: string, options: RoughBorderOptions = {}): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => roughBorder(el, options))
}
