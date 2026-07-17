import * as THREE from "three"
import type { ComposedRoad } from "../shared/world-composer"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createToonMaterial } from "./toon-materials"

interface RoadPoint {
  x: number
  z: number
}

interface ProceduralRoadOptions {
  trailheadClearing?: RoadPoint
}

function smoothRoadPoints(points: readonly RoadPoint[]): RoadPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }))
  const smoothed: RoadPoint[] = [{ ...points[0] }]
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    smoothed.push(
      { x: start.x * 0.75 + end.x * 0.25, z: start.z * 0.75 + end.z * 0.25 },
      { x: start.x * 0.25 + end.x * 0.75, z: start.z * 0.25 + end.z * 0.75 },
    )
  }
  smoothed.push({ ...points[points.length - 1] })
  return smoothed
}

function cumulativeDistances(points: readonly RoadPoint[]): number[] {
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].z - points[index - 1].z,
    ))
  }
  return distances
}

function smoothstep(amount: number): number {
  const t = Math.max(0, Math.min(1, amount))
  return t * t * (3 - 2 * t)
}

function roadGeometry(road: ComposedRoad, width: number, lift: number): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const points = smoothRoadPoints(road.points)
  const distances = cumulativeDistances(points)
  const totalDistance = distances[distances.length - 1]
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)]
    const next = points[Math.min(points.length - 1, index + 1)]
    const dx = next.x - previous.x
    const dz = next.z - previous.z
    const length = Math.max(0.001, Math.hypot(dx, dz))
    const startTaper = road.taperStart
      ? 0.42 + smoothstep(distances[index] / 5.5) * 0.58
      : 1
    const endTaper = road.taperEnd
      ? 0.42 + smoothstep((totalDistance - distances[index]) / 5.5) * 0.58
      : 1
    const pointWidth = width * Math.min(startTaper, endTaper)
    const nx = -dz / length * pointWidth / 2
    const nz = dx / length * pointWidth / 2
    for (const side of [-1, 1]) {
      const x = point.x + nx * side
      const z = point.z + nz * side
      positions.push(x, sherwoodHeightAt(x, z) + lift, z)
      uvs.push(index / Math.max(1, points.length - 1), side < 0 ? 0 : 1)
    }
    if (index < points.length - 1) {
      const base = index * 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
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

function clearingGeometry(center: RoadPoint, radius: number, lift: number): THREE.BufferGeometry {
  const segments = 24
  const positions = [center.x, sherwoodHeightAt(center.x, center.z) + lift, center.z]
  const indices: number[] = []
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2
    const edgeRadius = radius * (1 + Math.sin(angle * 3 + 0.8) * 0.045 + Math.sin(angle * 7) * 0.025)
    const x = center.x + Math.cos(angle) * edgeRadius
    const z = center.z + Math.sin(angle) * edgeRadius
    positions.push(x, sherwoodHeightAt(x, z) + lift, z)
    if (index < segments) indices.push(0, index + 2, index + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function createProceduralRoads(
  roads: readonly ComposedRoad[],
  options: ProceduralRoadOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodProceduralRoads"
  const shoulderMaterial = createToonMaterial({ color: 0x4e5135 })
  const majorPathMaterial = createToonMaterial({ color: 0x75613f })
  const trackMaterial = createToonMaterial({ color: 0x5f5b3d })
  if (options.trailheadClearing) {
    const shoulder = new THREE.Mesh(
      clearingGeometry(options.trailheadClearing, 3.25, 0.09),
      shoulderMaterial,
    )
    shoulder.name = "TrailheadClearingShoulder"
    shoulder.receiveShadow = true
    const clearing = new THREE.Mesh(
      clearingGeometry(options.trailheadClearing, 2.75, 0.14),
      majorPathMaterial,
    )
    clearing.name = "TrailheadClearing"
    clearing.receiveShadow = true
    group.add(shoulder, clearing)
  }
  for (const road of roads) {
    const shoulder = new THREE.Mesh(
      roadGeometry(road, road.width + (road.width >= 3 ? 0.55 : 0.35), 0.09),
      shoulderMaterial,
    )
    shoulder.name = `RoadShoulder_${road.id}`
    shoulder.receiveShadow = true
    shoulder.castShadow = false
    const mesh = new THREE.Mesh(
      roadGeometry(road, road.width, 0.14),
      road.width >= 3 ? majorPathMaterial : trackMaterial,
    )
    mesh.name = `Road_${road.id}`
    mesh.receiveShadow = true
    mesh.castShadow = false
    group.add(shoulder, mesh)
  }
  return group
}
