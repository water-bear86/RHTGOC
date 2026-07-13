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
      expect(character.getObjectByName("RigLeftArmForearm")).toBeTruthy()
      expect(character.getObjectByName("RigRightArmHand")).toBeTruthy()
      expect(character.getObjectByName("RigRightLeg")).toBeTruthy()
      expect(character.getObjectByName("RigRightLegShin")).toBeTruthy()
      expect(character.getObjectByName("RigLeftLegBoot")).toBeTruthy()
      expect(character.getObjectByName("FaceLeftEye")).toBeTruthy()
    }
  })

  it("gives every outlaw a role-specific silhouette prop", () => {
    expect(createHeroCharacter("robin").getObjectByName("RobinFeather")).toBeTruthy()
    expect(createHeroCharacter("robin").getObjectByName("RobinLeftBracer")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianMantle")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianSash")).toBeTruthy()
    expect(createHeroCharacter("little-john").getObjectByName("JohnQuarterstaff")).toBeTruthy()
    expect(createHeroCharacter("little-john").getObjectByName("JohnVestLeft")).toBeTruthy()
    expect(createHeroCharacter("much").getObjectByName("MuchSatchel")).toBeTruthy()
    expect(createHeroCharacter("much").getObjectByName("MuchNeckerchief")).toBeTruthy()
  })

  it("poses articulated limbs for walking and attacks", () => {
    const robin = createHeroCharacter("robin")
    poseHeroCharacter(robin, { elapsed: 0.15, moving: true, action: "idle" })
    const walkingLeg = robin.getObjectByName("RigLeftLeg")!
    expect(Math.abs(walkingLeg.rotation.x)).toBeGreaterThan(0.1)
    poseHeroCharacter(robin, { elapsed: 0.15, moving: false, action: "attack" })
    expect(robin.getObjectByName("RigLeftArm")!.rotation.x).toBeCloseTo(-1.48)
    expect(robin.getObjectByName("RigRightArmForearm")!.rotation.x).toBeCloseTo(-1.15)
  })

  it("uses a grounded staff pose for Little John's signature", () => {
    const john = createHeroCharacter("little-john")
    poseHeroCharacter(john, { elapsed: 0.15, moving: false, action: "signature" })
    expect(john.getObjectByName("JohnQuarterstaff")).toBeTruthy()
    expect(john.getObjectByName("RigLeftArmForearm")!.rotation.x).toBeCloseTo(-0.62)
  })
})
