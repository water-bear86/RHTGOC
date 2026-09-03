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
let softGroundGradientMap: THREE.DataTexture | null = null

function getSoftGroundGradientMap(): THREE.DataTexture {
  if (softGroundGradientMap) return softGroundGradientMap
  softGroundGradientMap = new THREE.DataTexture(
    new Uint8Array([
      142, 142, 142, 255,
      184, 184, 184, 255,
      222, 222, 222, 255,
      255, 255, 255, 255,
    ]),
    4,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  softGroundGradientMap.name = "Sherwood soft ground toon ramp"
  softGroundGradientMap.minFilter = THREE.NearestFilter
  softGroundGradientMap.magFilter = THREE.NearestFilter
  softGroundGradientMap.generateMipmaps = false
  softGroundGradientMap.wrapS = THREE.ClampToEdgeWrapping
  softGroundGradientMap.wrapT = THREE.ClampToEdgeWrapping
  softGroundGradientMap.colorSpace = THREE.NoColorSpace
  softGroundGradientMap.needsUpdate = true
  return softGroundGradientMap
}

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
  // TextureLoader marks the texture dirty after image decode. Doing it here
  // asks WebGL to upload an empty source on every frame during network load.
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
    normalScale: new THREE.Vector2(0.14, 0.14),
    emissive: kind === "meadow" ? 0x24351d : 0x2b241a,
    emissiveIntensity: kind === "meadow" ? 0.42 : 0.22,
  }
  if (options.polygonOffset !== undefined) parameters.polygonOffset = options.polygonOffset
  if (options.polygonOffsetFactor !== undefined) parameters.polygonOffsetFactor = options.polygonOffsetFactor
  const material = createToonMaterial(parameters)
  material.gradientMap = getSoftGroundGradientMap()
  material.name = kind === "meadow" ? "SherwoodMeadowGround" : "SherwoodForestFloor"
  return material
}
