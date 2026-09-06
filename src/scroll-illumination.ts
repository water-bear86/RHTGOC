import type { ScrollRecord } from "../shared/scroll-record"
import { levelForExperience } from "../shared/scroll-record"
import type { ScrollCheckpointStatus } from "./scroll-store"

/**
 * Procedural illumination for the Scroll.
 *
 * Every scroll is drawn from the player's own identity, so two outlaws never
 * hold the same document: the vine border, the marginal sprigs, the seal
 * sigil and the seal's colour are all derived from a seed and from what the
 * player has actually done. Nothing here is random at runtime — the same
 * record always produces the same illumination, which matters because the
 * scroll is a save file and players will recognise their own.
 *
 * All geometry is generated in a fixed 0..1000 x 0..1400 space and scaled by
 * the SVG viewBox, so the drawing is resolution independent and costs one
 * inline element with no images and no network.
 */

export const ILLUMINATION_WIDTH = 1000
export const ILLUMINATION_HEIGHT = 1400

/** Deterministic 32-bit hash. Same string in, same seed out, on every engine. */
export function scrollSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, well-distributed, and identical across engines. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The identity a scroll's illumination is seeded from. The wallet when there
 * is one, so a scroll looks the same on every device the player signs in on;
 * otherwise the outlaw name, so a guest still gets a stable scroll.
 */
export function illuminationSeedSource(record: ScrollRecord): string {
  return record.wallet ?? `guest:${record.outlawName.toLowerCase()}`
}

export interface SealAppearance {
  /** Wax colour. */
  fill: string
  /** Darker rim. */
  rim: string
  /** One-or-two character sigil pressed into the wax. */
  sigil: string
  /** Degrees. Wax is never stamped perfectly straight. */
  rotation: number
  /** Human-readable state, shown beside the seal. */
  label: string
  /** True when the seal is broken/absent and should render as an outline. */
  broken: boolean
}

const SIGILS = ["✦", "✧", "❦", "✶", "❧", "✵", "⚜", "✱"] as const

const STATUS_APPEARANCE: Record<ScrollCheckpointStatus, { fill: string; rim: string; label: string; broken: boolean }> = {
  unbound: { fill: "#8a8172", rim: "#5d564a", label: "Unbound · this browser only", broken: true },
  unsealed: { fill: "#a8874a", rim: "#6f5825", label: "Unsealed · no Scroll minted", broken: true },
  pending: { fill: "#b8791f", rim: "#7d4f10", label: "Pending · deeds not yet lodged", broken: false },
  recorded: { fill: "#3e6b3a", rim: "#254220", label: "Recorded · awaiting the next seal", broken: false },
  sealed: { fill: "#8f2a1f", rim: "#5e170f", label: "Sealed on Robinhood Chain", broken: false },
  diverged: { fill: "#6b2f6b", rim: "#3f1a3f", label: "Diverged · seal does not match", broken: true },
}

export function sealAppearance(record: ScrollRecord, status: ScrollCheckpointStatus): SealAppearance {
  const random = seededRandom(scrollSeed(illuminationSeedSource(record)))
  const sigil = SIGILS[Math.floor(random() * SIGILS.length)] ?? SIGILS[0]
  const rotation = Math.round((random() * 16 - 8) * 10) / 10
  const base = STATUS_APPEARANCE[status]
  return { fill: base.fill, rim: base.rim, label: base.label, broken: base.broken, sigil, rotation }
}

export interface VineSegment {
  /** SVG path `d` for one length of border vine. */
  d: string
  /** Leaf anchor points along the vine. */
  leaves: { x: number; y: number; angle: number; size: number }[]
}

/**
 * A border vine down one edge. `side` is -1 for the left edge, 1 for the right.
 * Denser and leafier as the player's renown grows, so a veteran's scroll is
 * visibly more decorated than a first-day scroll.
 */
export function borderVine(seed: number, side: -1 | 1, level: number): VineSegment {
  const random = seededRandom(seed ^ (side === 1 ? 0x9e3779b9 : 0x85ebca6b))
  const x = side === -1 ? 54 : ILLUMINATION_WIDTH - 54
  const top = 70
  const bottom = ILLUMINATION_HEIGHT - 70
  const knots = 7 + Math.min(9, Math.floor(level / 4))
  const step = (bottom - top) / knots

  let d = `M ${x} ${top}`
  const leaves: VineSegment["leaves"] = []
  for (let i = 0; i < knots; i += 1) {
    const y0 = top + step * i
    const y1 = y0 + step
    const swing = (14 + random() * 20) * (i % 2 === 0 ? 1 : -1) * side
    const cx = x + swing
    d += ` Q ${round(cx)} ${round(y0 + step / 2)} ${x} ${round(y1)}`
    const leafCount = 1 + (random() < 0.45 ? 1 : 0)
    for (let leaf = 0; leaf < leafCount; leaf += 1) {
      leaves.push({
        x: round(x + swing * (0.55 + random() * 0.4)),
        y: round(y0 + step * (0.25 + random() * 0.5)),
        angle: Math.round((random() * 60 - 30 + (side === 1 ? 180 : 0)) * 10) / 10,
        size: Math.round((9 + random() * 7) * 10) / 10,
      })
    }
  }
  return { d, leaves }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

export interface ScrollIllumination {
  seed: number
  width: number
  height: number
  vines: [VineSegment, VineSegment]
  seal: SealAppearance
  /** Corner flourish scale, 0..1, grows with completed achievements. */
  flourish: number
}

export function buildScrollIllumination(record: ScrollRecord, status: ScrollCheckpointStatus): ScrollIllumination {
  const seed = scrollSeed(illuminationSeedSource(record))
  const level = levelForExperience(record.experience)
  return {
    seed,
    width: ILLUMINATION_WIDTH,
    height: ILLUMINATION_HEIGHT,
    vines: [borderVine(seed, -1, level), borderVine(seed, 1, level)],
    seal: sealAppearance(record, status),
    flourish: Math.max(0, Math.min(1, record.achievements.length / 10)),
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char)
}

/**
 * Render the illumination as an inline SVG string. Decorative only — it is
 * marked aria-hidden by the caller, and every fact it depicts is also present
 * as real text in the panel.
 */
export function illuminationSvg(illumination: ScrollIllumination): string {
  const [left, right] = illumination.vines
  const vinePaths = [left, right]
    .map((vine) => `<path d="${vine.d}" fill="none" stroke="#6f8f4d" stroke-width="3" stroke-linecap="round" opacity=".55"/>`)
    .join("")
  const leaves = [left, right]
    .flatMap((vine) => vine.leaves)
    .map(
      (leaf) =>
        `<ellipse cx="${leaf.x}" cy="${leaf.y}" rx="${leaf.size}" ry="${round(leaf.size / 2.4)}" fill="#3e6b3a" opacity=".42" transform="rotate(${leaf.angle} ${leaf.x} ${leaf.y})"/>`,
    )
    .join("")
  const flourishOpacity = round(0.18 + illumination.flourish * 0.32)
  const corners = [
    [70, 70, 0],
    [ILLUMINATION_WIDTH - 70, 70, 90],
    [ILLUMINATION_WIDTH - 70, ILLUMINATION_HEIGHT - 70, 180],
    [70, ILLUMINATION_HEIGHT - 70, 270],
  ]
    .map(
      ([cx, cy, angle]) =>
        `<path d="M 0 0 q 34 4 46 30 q -30 -12 -46 4 z" fill="#c69430" opacity="${flourishOpacity}" transform="translate(${cx} ${cy}) rotate(${angle})"/>`,
    )
    .join("")

  return [
    `<svg viewBox="0 0 ${illumination.width} ${illumination.height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" focusable="false">`,
    corners,
    vinePaths,
    leaves,
    `</svg>`,
  ].join("")
}

/** The wax seal, drawn on its own so it can sit inline beside the status text. */
export function sealSvg(seal: SealAppearance): string {
  const body = seal.broken
    ? `<circle cx="50" cy="50" r="34" fill="none" stroke="${seal.rim}" stroke-width="4" stroke-dasharray="9 7" opacity=".85"/>`
    : `<circle cx="50" cy="50" r="36" fill="${seal.fill}"/><circle cx="50" cy="50" r="36" fill="none" stroke="${seal.rim}" stroke-width="4"/><circle cx="50" cy="50" r="27" fill="none" stroke="${seal.rim}" stroke-width="1.5" opacity=".7"/>`
  const sigilFill = seal.broken ? seal.rim : "#f7f0d4"
  return [
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">`,
    `<g transform="rotate(${seal.rotation} 50 50)">`,
    body,
    `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="30" fill="${sigilFill}" opacity=".92">${escapeXml(seal.sigil)}</text>`,
    `</g></svg>`,
  ].join("")
}
