import * as THREE from "three"
import type { ComposedRoad } from "../shared/world-composer"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createToonMaterial } from "./toon-materials"

function roadGeometry(road: ComposedRoad): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  road.points.forEach((point, index) => {
    const previous = road.points[Math.max(0, index - 1)]
    const next = road.points[Math.min(road.points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    const length = Math.max(0.001, Math.hypot(dx, dz))
    const nx = -dz / length * road.width / 2
    const nz = dx / length * road.width / 2
    for (const side of [-1, 1]) {
      const x = point.x + nx * side
      const z = point.z + nz * side
      positions.push(x, sherwoodHeightAt(x, z) + 0.045, z)
      uvs.push(index / Math.max(1, road.points.length - 1), side < 0 ? 0 : 1)
    }
    if (index < road.points.length - 1) {
      const base = index * 2
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function createProceduralRoads(roads: readonly ComposedRoad[]): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodProceduralRoads"
  const pathMaterial = createToonMaterial({ color: 0x9a7c50 })
  for (const road of roads) {
    const mesh = new THREE.Mesh(roadGeometry(road), pathMaterial)
    mesh.name = `Road_${road.id}`
    mesh.receiveShadow = true
    mesh.castShadow = false
    group.add(mesh)
  }
  return group
}

