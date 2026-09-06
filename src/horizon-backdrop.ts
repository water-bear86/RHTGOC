import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { createToonMaterial } from "./toon-materials"
import { sherwoodHeightAt } from "./sherwood-terrain"

/**
 * Late-afternoon Sherwood horizon: one warm parchment hex used for fog, the scene's clear
 * colour, the sky dome at and below the horizon line, and the colour the ground apron and
 * forest wall haze toward in the distance. Every layer converges here so no seam can exist.
 */
export const HORIZON_COLOR = 0xdad2a9
export const HORIZON_FOG_DENSITY = 0.012

/**
 * Outer edge of the ground apron. Must cover the farthest ground point any camera frame can
 * ever show: camera |coord| tops out at 82.5 (SHERWOOD_REGIONAL_BOUNDS 67 + camera offset
 * radius 15.5); the worst-case top-of-frame ray reaches ~85u beyond that. 180 clears both with
 * margin (see the acceptance-test inequality in horizon-backdrop.test.ts).
 */
export const APRON_HALF_EXTENT = 180

/** Closest a wall tree can stand (row A radius minus its jitter). Must clear the camera radius. */
export const WALL_INNER_MIN = 97
/** Farthest a wall tree can stand (row B radius plus its jitter). */
export const WALL_OUTER_MAX = 112

const SKY_DOME_RADIUS = 230

const BARK_COLOR = 0x4a3626
const CROWN_COLOR_A = 0x2e5233
const CROWN_COLOR_B = 0x3f6b3f

interface SkyStop {
  readonly deg: number
  readonly hex: number
}

const SKY_STOPS: readonly SkyStop[] = [
  { deg: 0, hex: 0xdad2a9 },
  { deg: 6, hex: 0xd1d4b6 },
  { deg: 18, hex: 0xa9bfc3 },
  { deg: 45, hex: 0x7f9db4 },
  { deg: 90, hex: 0x6f8fa8 },
]

interface WallRowConfig {
  readonly radius: number
  readonly jitterRadius: number
  readonly count: number
  readonly heightMin: number
  readonly heightMax: number
  readonly haze: number
}

/** Two square rings; a circle close enough to see through fog could pass inside the terrain corners. */
const WALL_ROWS: readonly WallRowConfig[] = [
  { radius: 100, jitterRadius: 3, count: 160, heightMin: 13, heightMax: 17, haze: 0.15 },
  { radius: 108, jitterRadius: 4, count: 100, heightMin: 16, heightMax: 21, haze: 0.35 },
]

export interface WallTreePlacement {
  readonly x: number
  readonly z: number
  readonly height: number
  readonly haze: number
  readonly rotation: number
  readonly luminanceJitter: number
  readonly broadleaf: boolean
}

export interface HorizonBackdropOptions {
  readonly groundMaterial: THREE.Material
}

export interface HorizonBackdrop {
  readonly group: THREE.Group
  update(camera: THREE.Camera): void
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }
}

function colorFromSrgbBytes(r: number, g: number, b: number): THREE.Color {
  const hex = (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
}

/**
 * Sky ramp: linear interpolation of the sRGB channel bytes between the authored stops, then
 * written through THREE.Color.setHex so the returned colour is linear-encoded as three expects
 * for a `toneMapped: false` MeshBasicMaterial (or a vertex-colour attribute).
 */
export function skyColorAtElevation(elevationDeg: number): THREE.Color {
  const first = SKY_STOPS[0]
  const last = SKY_STOPS[SKY_STOPS.length - 1]
  if (elevationDeg <= first.deg) {
    const rgb = hexToRgb(first.hex)
    return colorFromSrgbBytes(rgb.r, rgb.g, rgb.b)
  }
  if (elevationDeg >= last.deg) {
    const rgb = hexToRgb(last.hex)
    return colorFromSrgbBytes(rgb.r, rgb.g, rgb.b)
  }

  let lower = first
  let upper = last
  for (let index = 0; index < SKY_STOPS.length - 1; index += 1) {
    if (elevationDeg >= SKY_STOPS[index].deg && elevationDeg <= SKY_STOPS[index + 1].deg) {
      lower = SKY_STOPS[index]
      upper = SKY_STOPS[index + 1]
      break
    }
  }
  const t = (elevationDeg - lower.deg) / (upper.deg - lower.deg)
  const a = hexToRgb(lower.hex)
  const b = hexToRgb(upper.hex)
  return colorFromSrgbBytes(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
}

/** Lerps a base colour toward HORIZON_COLOR by `haze`, then applies a per-tree luminance jitter. */
function hazedJitteredColor(baseHex: number, haze: number, luminanceJitter: number): THREE.Color {
  const base = hexToRgb(baseHex)
  const horizon = hexToRgb(HORIZON_COLOR)
  const scale = 1 + luminanceJitter
  const r = (base.r + (horizon.r - base.r) * haze) * scale
  const g = (base.g + (horizon.g - base.g) * haze) * scale
  const b = (base.b + (horizon.b - base.b) * haze) * scale
  return colorFromSrgbBytes(r, g, b)
}

function paintVertexColors(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.getAttribute("position").count
  const array = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    array[index * 3] = color.r
    array[index * 3 + 1] = color.g
    array[index * 3 + 2] = color.b
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(array, 3))
}

/**
 * A grid strip of the ground apron. UVs are in the terrain's own frame (u = (x+92)/184,
 * v = (z+92)/184) so it shares the terrain's textures and repeat with no visible seam.
 */
function buildApronStrip(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  segmentsX: number,
  segmentsZ: number,
): THREE.BufferGeometry {
  const rowSize = segmentsX + 1
  const colSize = segmentsZ + 1
  const positions = new Float32Array(rowSize * colSize * 3)
  const uvs = new Float32Array(rowSize * colSize * 2)
  const indices: number[] = []
  const stepX = (maxX - minX) / segmentsX
  const stepZ = (maxZ - minZ) / segmentsZ

  for (let zIndex = 0; zIndex < colSize; zIndex += 1) {
    const z = minZ + zIndex * stepZ
    for (let xIndex = 0; xIndex < rowSize; xIndex += 1) {
      const x = minX + xIndex * stepX
      const vertexIndex = zIndex * rowSize + xIndex
      positions[vertexIndex * 3] = x
      positions[vertexIndex * 3 + 1] = sherwoodHeightAt(x, z)
      positions[vertexIndex * 3 + 2] = z
      uvs[vertexIndex * 2] = (x + 92) / 184
      uvs[vertexIndex * 2 + 1] = (z + 92) / 184
    }
  }

  for (let zIndex = 0; zIndex < segmentsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex < segmentsX; xIndex += 1) {
      const a = zIndex * rowSize + xIndex
      const b = a + 1
      const c = a + rowSize
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildApronGeometry(): THREE.BufferGeometry {
  const strips = [
    buildApronStrip(-APRON_HALF_EXTENT, APRON_HALF_EXTENT, 92, APRON_HALF_EXTENT, 90, 22), // north
    buildApronStrip(-APRON_HALF_EXTENT, APRON_HALF_EXTENT, -APRON_HALF_EXTENT, -92, 90, 22), // south
    buildApronStrip(92, APRON_HALF_EXTENT, -92, 92, 46, 22), // east
    buildApronStrip(-APRON_HALF_EXTENT, -92, -92, 92, 46, 22), // west
  ]
  return mergeGeometries(strips, false)!
}

/** Same 16807 LCG recurrence as src/forest-dressing.ts. */
function createLcg(seed: number): () => number {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

/** Walks one continuous loop around a square ring so all four corners are filled without a gap. */
function squareRingPoint(t: number, radius: number): { x: number; z: number } {
  const side = radius * 2
  const perimeter = side * 4
  const wrapped = ((t % perimeter) + perimeter) % perimeter
  const segment = Math.min(3, Math.floor(wrapped / side))
  const local = wrapped - segment * side
  switch (segment) {
    case 0: return { x: -radius + local, z: -radius }
    case 1: return { x: radius, z: -radius + local }
    case 2: return { x: radius - local, z: radius }
    default: return { x: -radius, z: radius - local }
  }
}

/**
 * Pure placement data for every wall tree, seeded so the same forest generates every call.
 * Exported for testability (bounds/count checks); createHorizonBackdrop consumes it directly.
 */
export function generateWallTreePlacements(): WallTreePlacement[] {
  const rng = createLcg(0x4f414b)
  const placements: WallTreePlacement[] = []
  let globalIndex = 0
  for (const row of WALL_ROWS) {
    const perimeter = row.radius * 8
    const slot = perimeter / row.count
    for (let i = 0; i < row.count; i += 1) {
      const tangentialJitter = (rng() - 0.5) * slot
      const nominal = squareRingPoint(i * slot + tangentialJitter, row.radius)
      const radialJitter = (rng() * 2 - 1) * row.jitterRadius
      const scale = (row.radius + radialJitter) / row.radius
      const height = row.heightMin + rng() * (row.heightMax - row.heightMin)
      const rotation = rng() * Math.PI * 2
      const luminanceJitter = (rng() * 2 - 1) * 0.05
      placements.push({
        x: nominal.x * scale,
        z: nominal.z * scale,
        height,
        haze: row.haze,
        rotation,
        luminanceJitter,
        broadleaf: globalIndex % 4 === 0,
      })
      globalIndex += 1
    }
  }
  return placements
}

function buildTreeGeometry(placement: WallTreePlacement): THREE.BufferGeometry {
  const { height, haze, luminanceJitter, broadleaf } = placement
  const parts: THREE.BufferGeometry[] = []

  const trunk = new THREE.CylinderGeometry(0.06 * height, 0.09 * height, 0.30 * height, 6).toNonIndexed()
  trunk.translate(0, 0.15 * height, 0)
  paintVertexColors(trunk, hazedJitteredColor(BARK_COLOR, haze, luminanceJitter))
  parts.push(trunk)

  if (broadleaf) {
    const radius = 0.30 * height
    for (const [blobIndex, fraction] of [0.55, 0.75].entries()) {
      const blob = new THREE.IcosahedronGeometry(radius, 1)
      blob.scale(1, 0.7, 1)
      blob.translate(0, fraction * height, 0)
      paintVertexColors(blob, hazedJitteredColor(blobIndex % 2 === 0 ? CROWN_COLOR_A : CROWN_COLOR_B, haze, luminanceJitter))
      parts.push(blob)
    }
  } else {
    const cones = [
      { radius: 0.28, height: 0.40, base: 0.30 },
      { radius: 0.22, height: 0.35, base: 0.55 },
      { radius: 0.15, height: 0.30, base: 0.78 },
    ]
    for (const [coneIndex, cone] of cones.entries()) {
      const coneHeight = cone.height * height
      const geometry = new THREE.ConeGeometry(cone.radius * height, coneHeight, 7).toNonIndexed()
      geometry.translate(0, cone.base * height + coneHeight / 2, 0)
      paintVertexColors(geometry, hazedJitteredColor(coneIndex % 2 === 0 ? CROWN_COLOR_A : CROWN_COLOR_B, haze, luminanceJitter))
      parts.push(geometry)
    }
  }

  const merged = mergeGeometries(parts, false)!
  merged.rotateY(placement.rotation)
  merged.translate(placement.x, sherwoodHeightAt(placement.x, placement.z) - 0.3, placement.z)
  return merged
}

function buildWallGeometry(): THREE.BufferGeometry {
  const trees = generateWallTreePlacements().map((placement) => buildTreeGeometry(placement))
  return mergeGeometries(trees, false)!
}

function buildSkyDomeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(SKY_DOME_RADIUS, 24, 16)
  const position = geometry.getAttribute("position")
  const colors = new Float32Array(position.count * 3)
  for (let index = 0; index < position.count; index += 1) {
    const elevationDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(position.getY(index) / SKY_DOME_RADIUS, -1, 1)),
    )
    const color = skyColorAtElevation(elevationDeg)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/**
 * The world's edge: a ground apron, a forest wall, and a sky dome — exactly 3 meshes / 3 draw
 * calls, sharing one horizon colour so no seam shows at any distance or camera angle.
 */
export function createHorizonBackdrop(options: HorizonBackdropOptions): HorizonBackdrop {
  const apron = new THREE.Mesh(buildApronGeometry(), options.groundMaterial)
  apron.name = "SherwoodHorizonApron"
  apron.receiveShadow = true
  apron.castShadow = false

  const wall = new THREE.Mesh(buildWallGeometry(), createToonMaterial({ vertexColors: true }))
  wall.name = "SherwoodHorizonTreeline"
  wall.castShadow = false
  wall.receiveShadow = false

  const dome = new THREE.Mesh(
    buildSkyDomeGeometry(),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
      toneMapped: false,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  )
  dome.name = "SherwoodSkyDome"
  dome.frustumCulled = false
  dome.renderOrder = -1

  const group = new THREE.Group()
  group.name = "SherwoodHorizonBackdrop"
  group.add(apron, wall, dome)

  return {
    group,
    update(camera: THREE.Camera): void {
      dome.position.copy(camera.position)
    },
  }
}
