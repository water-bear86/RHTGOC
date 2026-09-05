import * as THREE from "three"

export interface ShadowFrustumResult {
  centre: THREE.Vector3
  halfSize: number
  near: number
  far: number
}

const DEFAULT_HALF_SIZE = 40
const SUN_OFFSET = new THREE.Vector3(-18, 28, 14)

/**
 * Fit the directional light's orthographic shadow camera to the player.
 *
 * - Centres the frustum on the player's ground position.
 * - Snaps the centre to shadow-map texels so shadows don't shimmer as the
 *   player moves continuously.
 * - Keeps near/far tight around the scene instead of spanning 1..150.
 *
 * @param playerPos  World position of the player (x, z used; y ignored).
 * @param mapSize    Shadow map resolution in pixels (e.g. 2048).
 */
export function fitShadowFrustum(
  playerPos: { x: number; z: number },
  mapSize: number,
): ShadowFrustumResult {
  const halfSize = DEFAULT_HALF_SIZE
  const worldUnitsPerTexel = (2 * halfSize) / mapSize

  // Snap centre.x/z to texel grid to prevent shadow shimmer
  const snappedX = Math.round(playerPos.x / worldUnitsPerTexel) * worldUnitsPerTexel
  const snappedZ = Math.round(playerPos.z / worldUnitsPerTexel) * worldUnitsPerTexel

  const centre = new THREE.Vector3(snappedX, 0, snappedZ)

  // Distance from the sun offset to the centre, plus slack
  const sunToCentre = SUN_OFFSET.length()
  const far = sunToCentre + 60
  const near = 0.5

  return { centre, halfSize, near, far }
}

/**
 * Apply a fitted frustum to a directional light's shadow camera.
 * Call once per frame with the player's current position.
 */
export function applyShadowFrustum(
  sun: THREE.DirectionalLight,
  playerPos: { x: number; z: number },
): void {
  const mapSize = sun.shadow.mapSize.x
  const fit = fitShadowFrustum(playerPos, mapSize)

  // Position the sun relative to the snapped centre so the light direction
  // stays constant but the shadow frustum follows the player.
  sun.position.copy(fit.centre).add(SUN_OFFSET)
  sun.target.position.copy(fit.centre)
  sun.target.updateMatrixWorld()

  const cam = sun.shadow.camera
  cam.left = -fit.halfSize
  cam.right = fit.halfSize
  cam.top = fit.halfSize
  cam.bottom = -fit.halfSize
  cam.near = fit.near
  cam.far = fit.far
  cam.updateProjectionMatrix()
}
