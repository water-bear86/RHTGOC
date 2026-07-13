import { describe, expect, it } from "vitest"
import { createHeroCharacter, poseHeroCharacter } from "./character-visuals"

const heroes = ["robin", "marian", "little-john", "much"] as const

describe("procedural Merry Band characters", () => {
  it("builds all four heroes without imported assets", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      expect(character.name).toBe(`character.${hero}.procedural`)
      expect(character.getObjectByName("RigHead")).toBeTruthy()
      expect(character.getObjectByName("RigLeftArm")).toBeTruthy()
      expect(character.getObjectByName("RigRightLeg")).toBeTruthy()
      expect(character.getObjectByName("FaceLeftEye")).toBeTruthy()
    }
  })

  it("gives every outlaw a role-specific silhouette prop", () => {
    expect(createHeroCharacter("robin").getObjectByName("RobinFeather")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianMantle")).toBeTruthy()
    expect(createHeroCharacter("little-john").getObjectByName("JohnQuarterstaff")).toBeTruthy()
    expect(createHeroCharacter("much").getObjectByName("MuchSatchel")).toBeTruthy()
  })

  it("poses articulated limbs for walking and attacks", () => {
    const robin = createHeroCharacter("robin")
    poseHeroCharacter(robin, { elapsed: 0.15, moving: true, attacking: false })
    const walkingLeg = robin.getObjectByName("RigLeftLeg")!
    expect(Math.abs(walkingLeg.rotation.x)).toBeGreaterThan(0.1)
    poseHeroCharacter(robin, { elapsed: 0.15, moving: false, attacking: true })
    expect(robin.getObjectByName("RigLeftArm")!.rotation.x).toBeCloseTo(-1.22)
  })
})
