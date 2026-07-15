import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  FAMILY_PHOTO_CAPTURE_TIME_SECONDS,
  FAMILY_PHOTO_HEIGHT,
  FAMILY_PHOTO_WIDTH,
  createFamilyPhotoScene,
  type FamilyPhotoMetadata,
} from "./family-photo-scene"
import { convertObjectToToon } from "./toon-materials"
import { versionedAssetUrl } from "./release"

interface FamilyPhotoCaptureApi {
  ready: true
  metadata: FamilyPhotoMetadata
  renderFrame: (elapsed?: number) => void
  capturePng: () => string
}

declare global {
  interface Window {
    __SHERWOOD_FAMILY_PHOTO__?: FamilyPhotoCaptureApi
  }
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Family photo page is missing ${selector}`)
  return element
}

const host = requiredElement("#family-photo")
const status = requiredElement("#family-photo-status")

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
})
renderer.domElement.id = "family-photo-canvas"
renderer.domElement.setAttribute("aria-label", "The Merry Band and the Sheriff's guard assembled in a Sherwood village")
renderer.setPixelRatio(1)
renderer.setSize(FAMILY_PHOTO_WIDTH, FAMILY_PHOTO_HEIGHT, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.08
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
host.prepend(renderer.domElement)

const loader = new GLTFLoader()

async function loadCatalog(path: string): Promise<THREE.Group | undefined> {
  try {
    const asset = await loader.loadAsync(path)
    return convertObjectToToon(asset.scene)
  } catch (error) {
    console.warn(`Family photo asset fallback enabled for ${path}`, error)
    return undefined
  }
}

async function initialize(): Promise<void> {
  const [villageCatalog, treeCatalog] = await Promise.all([
    loadCatalog(versionedAssetUrl("/assets/environment/sherwood-village-slice.glb")),
    loadCatalog(versionedAssetUrl("/assets/environment/sherwood-tree-catalog.glb")),
  ])
  const portrait = createFamilyPhotoScene({ villageCatalog, treeCatalog })
  await portrait.ready

  const renderFrame = (elapsed = FAMILY_PHOTO_CAPTURE_TIME_SECONDS): void => {
    portrait.renderFrame(elapsed)
    renderer.render(portrait.scene, portrait.camera)
  }
  renderFrame()

  document.body.dataset.familyPhotoReady = "true"
  document.body.dataset.familyPhotoVillageAsset = portrait.metadata.villageAsset
  document.body.dataset.familyPhotoTreeAsset = portrait.metadata.treeAsset
  status.hidden = true
  window.__SHERWOOD_FAMILY_PHOTO__ = {
    ready: true,
    metadata: portrait.metadata,
    renderFrame,
    capturePng: () => renderer.domElement.toDataURL("image/png"),
  }

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault()
    status.hidden = false
    status.textContent = "WebGL context lost. Reload the portrait before capture."
    document.body.dataset.familyPhotoReady = "error"
  })
  window.addEventListener("beforeunload", () => {
    portrait.dispose()
    renderer.dispose()
  }, { once: true })
}

void initialize().catch((error) => {
  console.error("Family photo could not be initialized", error)
  status.textContent = "The Merry Band could not assemble. Reload to try again."
  document.body.dataset.familyPhotoReady = "error"
})
