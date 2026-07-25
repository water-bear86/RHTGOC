import * as THREE from "three"
import { sherwoodHeightAt } from "./sherwood-terrain"

export function sherwoodTerrainNormalAt(x: number, z: number, sampleRadius = 0.6): THREE.Vector3 {
  const radius = Math.max(0.05, sampleRadius)
  const riseX = sherwoodHeightAt(x + radius, z) - sherwoodHeightAt(x - radius, z)
  const riseZ = sherwoodHeightAt(x, z + radius) - sherwoodHeightAt(x, z - radius)
  return new THREE.Vector3(-riseX, radius * 2, -riseZ).normalize()
}

/**
 * Aligns a prop to the local terrain plane, then derives its Y offset from its
 * rendered bounds. A small negative inset prevents daylight under broad props.
 */
export function placeObjectOnSherwoodTerrain(
  object: THREE.Object3D,
  x: number,
  z: number,
  yaw = 0,
  inset = 0.04,
): void {
  const normal = sherwoodTerrainNormalAt(x, z)
  const alignToTerrain = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    normal,
  )
  const turnOnTerrain = new THREE.Quaternion().setFromAxisAngle(normal, yaw)
  object.position.set(0, 0, 0)
  object.quaternion.copy(turnOnTerrain).multiply(alignToTerrain)
  object.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(object)
  const localBottom = bounds.isEmpty() ? 0 : bounds.min.y
  object.position.set(x, sherwoodHeightAt(x, z) - localBottom - Math.max(0, inset), z)
  object.updateMatrixWorld(true)
}
