import * as THREE from "three"
import { sherwoodTopologyHeightAt } from "../shared/world-topology"
import { createToonMaterial } from "./toon-materials"

export const SHERWOOD_BRIDGE_LENGTH = 8.4
export const SHERWOOD_BRIDGE_WIDTH = 3.2
export const SHERWOOD_BRIDGE_HEIGHT = 0.3
export const SHERWOOD_BRIDGE_CENTER_Y = 0.18
export const SHERWOOD_BRIDGE_ROTATION = -0.1
export const SHERWOOD_BRIDGE_DECK_Y = SHERWOOD_BRIDGE_CENTER_Y + SHERWOOD_BRIDGE_HEIGHT / 2
/** Visual overdraw beyond the authoritative 67 m play boundary hides the square world edge from perimeter cameras. */
export const SHERWOOD_VISUAL_TERRAIN_SIZE = 184

export function sherwoodHeightAt(x: number, z: number): number {
  return sherwoodTopologyHeightAt(x, z)
}

export function sherwoodFootprintGroundY(
  x: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
  rotation = 0,
): number {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  let highest = Number.NEGATIVE_INFINITY
  for (const localX of [-halfWidth, 0, halfWidth]) {
    for (const localZ of [-halfDepth, 0, halfDepth]) {
      const sampleX = x + cosine * localX + sine * localZ
      const sampleZ = z - sine * localX + cosine * localZ
      highest = Math.max(highest, sherwoodHeightAt(sampleX, sampleZ))
    }
  }
  return Number.isFinite(highest) ? highest : sherwoodHeightAt(x, z)
}

function pointInsideBridgeDeck(
  x: number,
  z: number,
  crossing: Readonly<{ x: number; z: number }>,
): boolean {
  const dx = x - crossing.x
  const dz = z - crossing.z
  const cosine = Math.cos(SHERWOOD_BRIDGE_ROTATION)
  const sine = Math.sin(SHERWOOD_BRIDGE_ROTATION)
  const localX = cosine * dx - sine * dz
  const localZ = sine * dx + cosine * dz
  return Math.abs(localX) <= SHERWOOD_BRIDGE_LENGTH / 2
    && Math.abs(localZ) <= SHERWOOD_BRIDGE_WIDTH / 2
}

/** Visual standing height for characters; simulation remains authoritative in X/Z. */
export function sherwoodWalkableHeightAt(
  x: number,
  z: number,
  layout: { readonly crossingPositions: readonly Readonly<{ x: number; z: number }>[] },
): number {
  const terrainHeight = sherwoodHeightAt(x, z)
  return layout.crossingPositions.some((crossing) => pointInsideBridgeDeck(x, z, crossing))
    ? Math.max(terrainHeight, SHERWOOD_BRIDGE_DECK_Y)
    : terrainHeight
}

export function createSherwoodTerrain(size = SHERWOOD_VISUAL_TERRAIN_SIZE, segments = 112): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute("position")
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, sherwoodHeightAt(positions.getX(index), positions.getZ(index)))
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const terrain = new THREE.Mesh(geometry, createToonMaterial({ color: 0x3b5834 }))
  terrain.name = "SherwoodTopography"
  terrain.receiveShadow = true
  terrain.castShadow = false
  return terrain
}
