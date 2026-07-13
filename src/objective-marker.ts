import * as THREE from "three"

export interface ObjectiveMarker {
  group: THREE.Group
  groundRing: THREE.Mesh
  crownRing: THREE.Mesh
  label: THREE.Sprite
}

const OBJECTIVE_LABEL_WIDTH = 6.8
const OBJECTIVE_LABEL_HEIGHT = 1.8

function objectiveLabelTexture(labelText: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  canvas.width = 384
  canvas.height = 96
  const context = canvas.getContext("2d")!
  context.fillStyle = "rgba(11, 27, 21, .92)"
  context.strokeStyle = "#f0c85a"
  context.lineWidth = 5
  context.beginPath()
  context.roundRect(5, 5, 374, 86, 14)
  context.fill()
  context.stroke()
  context.fillStyle = "#ffe99a"
  context.font = "700 30px serif"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(labelText, 192, 49, 350)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A deliberately unsubtle marker used only after the target has been discovered. */
export function createObjectiveMarker(labelText = "SHERIFF'S CART"): ObjectiveMarker {
  const group = new THREE.Group()
  group.name = "DiscoveredObjectiveMarker"

  const groundRing = new THREE.Mesh(
    new THREE.RingGeometry(1.65, 1.95, 36),
    new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.92, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  )
  groundRing.name = "ObjectiveGroundRing"
  groundRing.rotation.x = -Math.PI / 2
  groundRing.position.y = 0.12

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.52, 18, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0.28, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  )
  beam.name = "ObjectiveBeaconBeam"
  beam.position.y = 9

  const crownRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.12, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe589, transparent: true, opacity: 1, depthWrite: false, depthTest: false }),
  )
  crownRing.name = "ObjectiveCrownRing"
  crownRing.rotation.x = Math.PI / 2
  crownRing.position.y = 10.5

  const flagPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 5.5, 6),
    new THREE.MeshBasicMaterial({ color: 0x4a3022, depthTest: false }),
  )
  flagPole.position.set(0, 3, 0)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.05),
    new THREE.MeshBasicMaterial({ color: 0xd8aa3c, side: THREE.DoubleSide, depthTest: false }),
  )
  flag.name = "ObjectiveFlag"
  flag.position.set(1.08, 5.15, 0)

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: objectiveLabelTexture(labelText), color: 0xffe589, transparent: true, depthTest: false, depthWrite: false }))
  label.name = "ObjectiveLabel"
  label.userData.objectiveLabelText = labelText
  label.position.y = 7.2
  label.scale.set(OBJECTIVE_LABEL_WIDTH, OBJECTIVE_LABEL_HEIGHT, 1)

  for (const object of [groundRing, beam, crownRing, flagPole, flag, label]) object.renderOrder = 30
  group.add(groundRing, beam, crownRing, flagPole, flag, label)
  return { group, groundRing, crownRing, label }
}

export function setObjectiveMarkerLabel(marker: ObjectiveMarker, labelText: string): void {
  if (marker.label.userData.objectiveLabelText === labelText) return
  const material = marker.label.material as THREE.SpriteMaterial
  material.map?.dispose()
  material.map = objectiveLabelTexture(labelText)
  material.needsUpdate = true
  marker.label.userData.objectiveLabelText = labelText
}

export function animateObjectiveMarker(marker: ObjectiveMarker, elapsed: number, motionScale = 1): void {
  marker.groundRing.rotation.z = -elapsed * 0.55 * motionScale
  marker.crownRing.rotation.z = elapsed * 0.72 * motionScale
  const pulse = 1 + Math.sin(elapsed * 4) * 0.08 * motionScale
  marker.label.scale.set(OBJECTIVE_LABEL_WIDTH * pulse, OBJECTIVE_LABEL_HEIGHT * pulse, 1)
}
