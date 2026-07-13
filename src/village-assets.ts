import * as THREE from "three"

/**
 * The shipping village GLB is a module catalog, not a prebuilt scene. Keep this
 * list in lockstep with the deterministic asset build so malformed or drifted
 * catalogs fail before they can produce a partly dressed level.
 */
export const VILLAGE_MODULE_NAMES = [
  "Wall_Plaster_WoodGrid",
  "Wall_Plaster_Door_Round",
  "Wall_Plaster_Window_Wide_Round",
  "Roof_RoundTiles_4x4",
  "Door_1_Round",
  "Window_Wide_Round1",
  "Stairs_Exterior_Straight",
  "Prop_Wagon",
  "Prop_Crate",
  "Prop_WoodenFence_Single",
  "Prop_WoodenFence_Extension1",
  "Prop_Vine2",
] as const

export type VillageModuleName = (typeof VILLAGE_MODULE_NAMES)[number]
export type VillageModuleCatalog = Readonly<Record<VillageModuleName, THREE.Object3D>>

export const VILLAGE_COTTAGE_DRAW_CALL_BUDGET = 24

export interface VillageCottageInstance {
  id: string
  position: Readonly<{ x: number; y: number; z: number }>
  rotation: number
  scale?: Readonly<{ x: number; y: number; z: number }>
}

export interface VillageCottageBatchOptions {
  castShadow?: boolean
}

export type VillageCottageRole =
  | "roof"
  | "front-door-wall"
  | "front-window-wall"
  | "rear-wall"
  | "left-wall"
  | "right-wall"
  | "door"
  | "window"
  | "steps"
  | "vine"

interface PlacementSpec {
  module: VillageModuleName
  role: VillageCottageRole
  position: readonly [number, number, number]
  rotationY?: number
  scale?: readonly [number, number, number]
}

const COTTAGE_PLACEMENTS: readonly PlacementSpec[] = [
  {
    module: "Wall_Plaster_Door_Round",
    role: "front-door-wall",
    position: [-0.9, 0, 1.55],
    scale: [0.9, 1, 1],
  },
  {
    module: "Wall_Plaster_Window_Wide_Round",
    role: "front-window-wall",
    position: [0.9, 0, 1.55],
    scale: [0.9, 1, 1],
  },
  {
    module: "Wall_Plaster_WoodGrid",
    role: "rear-wall",
    position: [0, 0, -1.55],
    rotationY: Math.PI,
    scale: [1.8, 1, 1],
  },
  {
    module: "Wall_Plaster_WoodGrid",
    role: "left-wall",
    position: [-1.8, 0, 0],
    rotationY: Math.PI / 2,
    scale: [1.55, 1, 1],
  },
  {
    module: "Wall_Plaster_WoodGrid",
    role: "right-wall",
    position: [1.8, 0, 0],
    rotationY: -Math.PI / 2,
    scale: [1.55, 1, 1],
  },
  {
    module: "Roof_RoundTiles_4x4",
    role: "roof",
    position: [0, 2.55, 0],
    scale: [0.72, 0.52, 0.72],
  },
  {
    module: "Door_1_Round",
    role: "door",
    position: [-1.35, 0, 1.76],
    scale: [0.8, 0.95, 0.8],
  },
  {
    module: "Window_Wide_Round1",
    role: "window",
    position: [0.9, 0.78, 1.76],
    scale: [0.8, 0.8, 0.8],
  },
  {
    module: "Stairs_Exterior_Straight",
    role: "steps",
    position: [-0.9, 0, 1.75],
    scale: [0.52, 0.52, 0.52],
  },
  {
    module: "Prop_Vine2",
    role: "vine",
    position: [0.45, 0.35, 1.77],
    scale: [0.65, 0.65, 0.65],
  },
] as const

const villageModuleNameSet = new Set<string>(VILLAGE_MODULE_NAMES)

/** Indexes only direct scene roots and rejects any catalog schema drift. */
export function indexVillageModules(source: THREE.Object3D): VillageModuleCatalog {
  const indexed = new Map<VillageModuleName, THREE.Object3D>()
  const duplicates: string[] = []
  const unexpected: string[] = []

  for (const child of source.children) {
    const runtimeId = typeof child.userData.sherwoodAssetId === "string"
      ? child.userData.sherwoodAssetId
      : child.name
    if (!villageModuleNameSet.has(runtimeId)) {
      unexpected.push(runtimeId || child.name || "<unnamed>")
      continue
    }

    const name = runtimeId as VillageModuleName
    if (indexed.has(name)) {
      duplicates.push(name)
      continue
    }
    indexed.set(name, child)
  }

  const missing = VILLAGE_MODULE_NAMES.filter((name) => !indexed.has(name))
  if (missing.length > 0 || duplicates.length > 0 || unexpected.length > 0) {
    const problems = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      duplicates.length > 0 ? `duplicates: ${duplicates.join(", ")}` : "",
      unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : "",
    ].filter(Boolean)
    throw new Error(`Invalid village module catalog (${problems.join("; ")})`)
  }

  const catalog = {} as Record<VillageModuleName, THREE.Object3D>
  for (const name of VILLAGE_MODULE_NAMES) catalog[name] = indexed.get(name)!
  return Object.freeze(catalog)
}

/**
 * Deep-clones the node hierarchy while deliberately sharing the immutable GPU
 * resources loaded from the GLB: geometry, materials, and their textures.
 */
export function cloneVillageModule(
  catalog: VillageModuleCatalog,
  name: VillageModuleName,
): THREE.Object3D {
  const clone = catalog[name].clone(true)
  clone.userData = {
    ...clone.userData,
    sherwoodVillageModule: name,
  }
  return clone
}

function createPlacement(catalog: VillageModuleCatalog, spec: PlacementSpec): THREE.Group {
  const placement = new THREE.Group()
  placement.name = `SherwoodVillageCottage:${spec.role}`
  placement.userData = {
    sherwoodVillageModule: spec.module,
    sherwoodVillageRole: spec.role,
  }
  placement.position.set(...spec.position)
  placement.rotation.y = spec.rotationY ?? 0
  if (spec.scale) placement.scale.set(...spec.scale)
  placement.add(cloneVillageModule(catalog, spec.module))
  return placement
}

/** Counts the render submissions made by visible mesh descendants. */
export function countVillageDrawCalls(root: THREE.Object3D): number {
  function renderPasses(material: THREE.Material): number {
    return material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1
  }

  function count(object: THREE.Object3D): number {
    if (!object.visible) return 0

    let draws = 0
    const candidate = object as THREE.Mesh
    if (candidate.isMesh) {
      const materials = candidate.material
      if (Array.isArray(materials)) {
        for (const group of candidate.geometry.groups) {
          const groupMaterial = materials[group.materialIndex ?? 0]
          if (group.count > 0 && groupMaterial) draws += renderPasses(groupMaterial)
        }
      } else {
        draws += renderPasses(materials)
      }
    }

    for (const child of object.children) draws += count(child)
    return draws
  }

  return count(root)
}

interface VillageMeshBucket {
  source: THREE.Mesh
  matrices: THREE.Matrix4[]
}

function cottageVariant(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function placementMatrix(spec: PlacementSpec, mirrored = false): THREE.Matrix4 {
  const mirrorFacade = mirrored && [
    "front-door-wall", "front-window-wall", "door", "window", "steps", "vine",
  ].includes(spec.role)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(mirrorFacade ? -spec.position[0] : spec.position[0], spec.position[1], spec.position[2]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.rotationY ?? 0),
    new THREE.Vector3(...(spec.scale ?? [1, 1, 1])),
  )
}

function cottageMatrix(cottage: VillageCottageInstance): THREE.Matrix4 {
  const scale = cottage.scale ?? { x: 1, y: 1, z: 1 }
  return new THREE.Matrix4().compose(
    new THREE.Vector3(cottage.position.x, cottage.position.y, cottage.position.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cottage.rotation),
    new THREE.Vector3(scale.x, scale.y, scale.z),
  )
}

/**
 * Instances every authored cottage module by source primitive. The number of
 * render submissions therefore remains constant as cottage count grows, while
 * geometry, materials, and textures stay owned by the loaded catalog.
 */
export function createVillageCottageBatch(
  source: THREE.Object3D,
  cottages: readonly VillageCottageInstance[],
  options: VillageCottageBatchOptions = {},
): THREE.Group {
  const catalog = indexVillageModules(source)
  source.updateMatrixWorld(true)
  const buckets = new Map<THREE.Mesh, VillageMeshBucket>()

  for (const spec of COTTAGE_PLACEMENTS) {
    const module = catalog[spec.module]
    const parentInverse = module.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4()
    module.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const relativeMeshMatrix = parentInverse.clone().multiply(object.matrixWorld)
      let bucket = buckets.get(object)
      if (!bucket) {
        bucket = { source: object, matrices: [] }
        buckets.set(object, bucket)
      }
      for (const cottage of cottages) {
        const mirrored = (cottageVariant(cottage.id) & 1) !== 0
        bucket.matrices.push(cottageMatrix(cottage).multiply(placementMatrix(spec, mirrored)).multiply(relativeMeshMatrix))
      }
    })
  }

  const group = new THREE.Group()
  group.name = "SherwoodVillageCottageBatch"
  group.userData = {
    sherwoodVillageKind: "cottage-batch",
    sherwoodVillageCottageCount: cottages.length,
    sherwoodVillageCottageIds: cottages.map((cottage) => cottage.id),
    sherwoodSharedResources: true,
  }
  const castShadow = options.castShadow ?? true
  let batchIndex = 0
  for (const bucket of buckets.values()) {
    if (bucket.matrices.length === 0) continue
    const instances = new THREE.InstancedMesh(
      bucket.source.geometry,
      bucket.source.material,
      bucket.matrices.length,
    )
    instances.name = `VillageCottageInstances:${bucket.source.name || ++batchIndex}`
    instances.userData = {
      sherwoodVillageKind: "cottage-instances",
      sherwoodVillageSourceMesh: bucket.source.name,
      sherwoodOwnedInstanceBuffer: true,
    }
    instances.castShadow = castShadow
    instances.receiveShadow = true
    bucket.matrices.forEach((matrix, index) => instances.setMatrixAt(index, matrix))
    instances.instanceMatrix.needsUpdate = true
    instances.computeBoundingBox()
    instances.computeBoundingSphere()
    group.add(instances)
  }
  const drawCalls = countVillageDrawCalls(group)
  if (drawCalls > VILLAGE_COTTAGE_DRAW_CALL_BUDGET) {
    for (const child of group.children) {
      if (child instanceof THREE.InstancedMesh) child.dispose()
    }
    throw new Error(
      `Village cottage batch uses ${drawCalls} draw calls; budget is ${VILLAGE_COTTAGE_DRAW_CALL_BUDGET}`,
    )
  }
  group.userData.sherwoodVillageDrawCalls = drawCalls
  return group
}

/** Releases only batch-owned instance buffers; catalog resources stay shared. */
export function disposeVillageCottageBatch(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.userData.sherwoodOwnedInstanceBuffer === true) object.dispose()
  })
}

/** Builds the one-off LOD0 cottage used to replace a procedural village hut. */
export function createVillageCottage(source: THREE.Object3D): THREE.Group {
  const catalog = indexVillageModules(source)
  const cottage = new THREE.Group()
  cottage.name = "SherwoodVillageCottage"
  cottage.userData = {
    sherwoodVillageKind: "cottage",
    sherwoodVillageRole: "cottage",
  }

  for (const spec of COTTAGE_PLACEMENTS) cottage.add(createPlacement(catalog, spec))

  const drawCalls = countVillageDrawCalls(cottage)
  if (drawCalls > VILLAGE_COTTAGE_DRAW_CALL_BUDGET) {
    throw new Error(
      `Village cottage uses ${drawCalls} draw calls; budget is ${VILLAGE_COTTAGE_DRAW_CALL_BUDGET}`,
    )
  }
  cottage.userData.sherwoodVillageDrawCalls = drawCalls
  return cottage
}

/**
 * Produces the wagon's visual shell only. Mission coin, cage, collision, and
 * objective state remain owned by the existing authoritative cart hierarchy.
 */
export function createVillageWagonShell(source: THREE.Object3D): THREE.Group {
  const catalog = indexVillageModules(source)
  const shell = new THREE.Group()
  shell.name = "SherwoodVillageWagonShell"
  shell.userData = {
    sherwoodVillageKind: "wagon-shell",
    sherwoodVillageModule: "Prop_Wagon",
    sherwoodVillageRole: "wagon-shell",
  }
  shell.rotation.y = Math.PI / 2
  shell.scale.setScalar(0.8)
  shell.add(cloneVillageModule(catalog, "Prop_Wagon"))
  return shell
}
