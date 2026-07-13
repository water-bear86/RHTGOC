import { describe, expect, it } from "vitest"
import { HERO_ACTION_DURATIONS, heroActionEnvelope, normalizedHeroActionProgress, sampleHeroAnimation } from "./character-animation"

const heroes = ["robin", "marian", "little-john", "much"] as const

describe("procedural hero animation sampler", () => {
  it("normalizes action clocks and exposes wind-up, commitment, and recovery", () => {
    expect(normalizedHeroActionProgress(10, 10, "attack")).toBe(0)
    expect(normalizedHeroActionProgress(10 + HERO_ACTION_DURATIONS.attack / 2, 10, "attack")).toBeCloseTo(0.5)
    expect(normalizedHeroActionProgress(20, 10, "attack")).toBe(1)
    expect(heroActionEnvelope(0)).toBe(0)
    expect(heroActionEnvelope(0.5)).toBe(1)
    expect(heroActionEnvelope(1)).toBe(0)
  })

  it("gives every outlaw a signature distinct from their normal attack", () => {
    for (const characterId of heroes) {
      const attack = sampleHeroAnimation({ characterId, elapsed: 0, moving: false, action: "attack", actionProgress: 0.5 })
      const signature = sampleHeroAnimation({ characterId, elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
      expect(signature).not.toEqual(attack)
    }
  })

  it("keeps semantic actions readable when reduced motion disables ambient oscillation", () => {
    const idle = sampleHeroAnimation({ characterId: "robin", elapsed: 0.4, moving: true, motionScale: 0 })
    const attack = sampleHeroAnimation({ characterId: "robin", elapsed: 0.4, moving: true, action: "attack", actionProgress: 0.5, motionScale: 0 })
    expect(idle.leftLeg.x).toBe(0)
    expect(attack.bowDraw).toBe(1)
    expect(Math.abs(attack.leftArm.x)).toBeGreaterThan(1)
  })

  it("uses the bow for John's normal attack and the staff for his signature", () => {
    const attack = sampleHeroAnimation({ characterId: "little-john", elapsed: 0, moving: false, action: "attack", actionProgress: 0.5 })
    const signature = sampleHeroAnimation({ characterId: "little-john", elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    expect(attack.showBow).toBe(true)
    expect(attack.showHandStaff).toBe(false)
    expect(attack.showBackStaff).toBe(true)
    expect(signature.showBow).toBe(false)
    expect(signature.showHandStaff).toBe(true)
    expect(signature.showBackStaff).toBe(false)
  })

  it("makes downed state override locomotion and active abilities", () => {
    for (const characterId of heroes) {
      const sample = sampleHeroAnimation({ characterId, elapsed: 1, moving: true, action: "signature", actionProgress: 0.5, downed: true })
      expect(sample.body.z).toBeGreaterThan(1)
      expect(sample.leftLeg.x).toBeLessThan(0)
      expect(sample.showHandStaff).toBe(false)
      expect(sample.showSignatureProp).toBe(false)
      expect(sample.bowDraw).toBe(0)
      expect(sample.showBow).toBe(true)
    }
  })

  it("always returns finite joint transforms", () => {
    const sample = sampleHeroAnimation({ characterId: "much", elapsed: Number.NaN, moving: true, action: "signature", actionProgress: Number.POSITIVE_INFINITY })
    for (const joint of [sample.body, sample.pelvis, sample.torso, sample.head, sample.leftArm, sample.rightArm, sample.leftForearm, sample.rightForearm, sample.leftLeg, sample.rightLeg, sample.leftShin, sample.rightShin]) {
      expect(Object.values(joint).every(Number.isFinite)).toBe(true)
    }
    expect(Number.isFinite(sample.bodyY)).toBe(true)
  })
})
