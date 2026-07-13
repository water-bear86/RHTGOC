import { describe, expect, it } from "vitest"
import { animateObjectiveMarker, createObjectiveMarker, setObjectiveMarkerLabel } from "./objective-marker"

describe("discovered objective marker", () => {
  it("provides a tall beam, flag, label, and ground ring", () => {
    const marker = createObjectiveMarker()
    expect(marker.group.getObjectByName("ObjectiveBeaconBeam")).toBeTruthy()
    expect(marker.group.getObjectByName("ObjectiveFlag")).toBeTruthy()
    expect(marker.group.getObjectByName("ObjectiveLabel")).toBeTruthy()
    expect(marker.group.getObjectByName("ObjectiveGroundRing")).toBeTruthy()
  })

  it("animates its independent navigation layers", () => {
    const marker = createObjectiveMarker()
    animateObjectiveMarker(marker, 1.4)
    expect(marker.groundRing.rotation.z).not.toBe(0)
    expect(marker.crownRing.rotation.z).not.toBe(0)
  })

  it("updates the marker copy for different mission targets", () => {
    const marker = createObjectiveMarker("SHERIFF'S CART")
    setObjectiveMarkerLabel(marker, "PRISON WAGON")
    expect(marker.label.userData.objectiveLabelText).toBe("PRISON WAGON")
  })
})
