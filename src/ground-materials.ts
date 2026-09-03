import * as THREE from "three"
import { createToonMaterial, type StorybookToonMaterial } from "./toon-materials"

export type SherwoodGroundKind = "meadow" | "forest-floor"
export type GroundTextureLoader = (url: string) => THREE.Texture | null

const GROUND_TEXTURES: Record<SherwoodGroundKind, Readonly<{ albedo: string; normal: string }>> = {
  meadow: {
    albedo: "/assets/environment/ground/wispy-grass-meadow-albedo.webp",
    normal: "/assets/environment/ground/wispy-grass-meadow-normal.webp",
  },
  "forest-floor": {
    albedo: "/assets/environment/ground/forest-trail-albedo.webp",
    normal: "/assets/environment/ground/forest-trail-normal.webp",
  },
}

let browserTextureLoader: THREE.TextureLoader | null = null
const browserTextureCache = new Map<string, THREE.Texture>()

const loadBrowserTexture: GroundTextureLoader = (url) => {
  if (typeof document === "undefined") return null
  const cached = browserTextureCache.get(url)
  if (cached) return cached
  browserTextureLoader ??= new THREE.TextureLoader()
  const texture = browserTextureLoader.load(url)
  browserTextureCache.set(url, texture)
  return texture
}

function configureTexture(
  texture: THREE.Texture,
  repeat: Readonly<{ x: number; y: number }>,
  color: boolean,
): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat.x, repeat.y)
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

export function createSherwoodGroundMaterial(
  kind: SherwoodGroundKind,
  options: {
    color?: THREE.ColorRepresentation
    repeat?: Readonly<{ x: number; y: number }>
    polygonOffset?: boolean
    polygonOffsetFactor?: number
    loadTexture?: GroundTextureLoader
  } = {},
): StorybookToonMaterial {
  const source = GROUND_TEXTURES[kind]
  const repeat = options.repeat ?? { x: 1, y: 1 }
  const loader = options.loadTexture ?? loadBrowserTexture
  const map = loader(source.albedo)
  const normalMap = loader(source.normal)
  const parameters: THREE.MeshToonMaterialParameters = {
    color: options.color ?? 0xffffff,
    map: map ? configureTexture(map, repeat, true) : null,
    normalMap: normalMap ? configureTexture(normalMap, repeat, false) : null,
    normalScale: new THREE.Vector2(0.24, 0.24),
  }
  if (options.polygonOffset !== undefined) parameters.polygonOffset = options.polygonOffset
  if (options.polygonOffsetFactor !== undefined) parameters.polygonOffsetFactor = options.polygonOffsetFactor
  const material = createToonMaterial(parameters)
  material.name = kind === "meadow" ? "SherwoodMeadowGround" : "SherwoodForestFloor"
  return material
}
