import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export function sherwoodHeightAt(x: number, z: number): number {
  const rolling = Math.sin(x * 0.075) * 0.85 + Math.cos(z * 0.061) * 0.68
  const ridge = Math.max(0, Math.sin((x + z) * 0.052) - 0.35) * 2.8
  const secondary = Math.sin((x - z) * 0.038 + 1.2) * 0.5
  const riverDistance = Math.abs(x - 1 + z * 0.1)
  const valleyBlend = Math.max(0, Math.min(1, (riverDistance - 3.2) / 6.5))
  return THREE.MathUtils.lerp(-0.48, 1.15 + rolling + ridge + secondary, valleyBlend)
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

