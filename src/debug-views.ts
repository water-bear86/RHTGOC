/**
 * Pure data describing `?view=<name>` debug camera positions, used to photograph the world
 * edge (and, in later tasks, other fixed spots) without wiring a real debug UI. Positions are
 * x/z only; the caller derives y from the terrain height so the module stays Three-free.
 */
export interface DebugView {
  readonly camera?: { readonly position: [number, number]; readonly target: [number, number] }
  readonly player?: { readonly x: number; readonly z: number }
}

export const DEBUG_VIEWS: Readonly<Record<string, DebugView>> = {
  // Looks out over the +x/+z corner; the top of the frame lands ~102u out, past the terrain edge.
  horizon: { camera: { position: [59.5, 56.5], target: [72, 72] } },
  // Looks along +x at the east edge from inside; the wall at 100 sits in the top band, 54u away.
  "horizon-x": { camera: { position: [46.1, 8], target: [66, 8] } },
  // Hero at the Major Oak's foot, trunk directly behind, boughs across the frame top.
  oak: { player: { x: -24, z: 11 }, camera: { position: [-16, 11], target: [-28, 11] } },
  // Teleports the hero into the public camp so the follow camera frames the
  // campfire, mission board, the three huts and the hero for scale grading.
  hub: { player: { x: -12.5, z: 10.5 } },
}

/** Reads `?view=<name>` from a location.search-style string. Returns null when absent or unknown. */
export function resolveDebugView(search: string): DebugView | null {
  const name = new URLSearchParams(search).get("view")
  if (!name) return null
  return DEBUG_VIEWS[name] ?? null
}
