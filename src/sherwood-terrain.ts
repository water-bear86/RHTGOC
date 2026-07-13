import * as THREE from "three"
import { sherwoodTopologyHeightAt } from "../shared/world-topology"
import { createToonMaterial } from "./toon-materials"

export function sherwoodHeightAt(x: number, z: number): number {
  return sherwoodTopologyHeightAt(x, z)
}

export function createSherwoodTerrain(size = 134, segments = 72): THREE.Mesh {
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
