import type { CharacterId } from "./simulation"

export type HeroAction = "idle" | "attack" | "signature"

export interface HeroAnimationInput {
  characterId: CharacterId
  elapsed: number
  moving: boolean
  action?: HeroAction
  /** Normalized time in the current action. Main should supply this from its action start time. */
  actionProgress?: number
  downed?: boolean
  motionScale?: number
}

export interface JointRotation {
  x: number
  y: number
  z: number
}

export interface HeroAnimationSample {
  bodyY: number
  body: JointRotation
  pelvis: JointRotation
  torso: JointRotation
  head: JointRotation
  leftArm: JointRotation
  rightArm: JointRotation
  leftForearm: JointRotation
  rightForearm: JointRotation
  leftLeg: JointRotation
  rightLeg: JointRotation
  leftShin: JointRotation
  rightShin: JointRotation
  capePitch: number
  capeRoll: number
  bowDraw: number
  showBow: boolean
  showHandStaff: boolean
  showBackStaff: boolean
  showSignatureProp: boolean
  showVolleyArrow: boolean
}

interface MotionProfile {
  cadence: number
  stride: number
  armSwing: number
  torsoLean: number
  downedLift: number
}

const MOTION_PROFILES: Record<CharacterId, MotionProfile> = {
  robin: { cadence: 10, stride: 0.62, armSwing: 0.62, torsoLean: 0.015, downedLift: 0.287 },
  marian: { cadence: 11.5, stride: 0.68, armSwing: 0.68, torsoLean: -0.015, downedLift: 0.067 },
  "little-john": { cadence: 8.2, stride: 0.48, armSwing: 0.52, torsoLean: -0.045, downedLift: 0.176 },
  much: { cadence: 10.8, stride: 0.58, armSwing: 0.66, torsoLean: 0.095, downedLift: 0.112 },
}

export const HERO_ACTION_DURATIONS: Readonly<Record<Exclude<HeroAction, "idle">, number>> = Object.freeze({
  attack: 0.8,
  signature: 0.9,
})

const canonicalZero = (value: number): number => value === 0 ? 0 : value
const rotation = (x = 0, y = 0, z = 0): JointRotation => ({
  x: canonicalZero(x),
  y: canonicalZero(y),
  z: canonicalZero(z),
})
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const smoothstep = (value: number): number => {
  const amount = clamp01(value)
  return amount * amount * (3 - 2 * amount)
}

/** Converts a deadline-style action clock into normalized action time. */
export function normalizedHeroActionProgress(elapsed: number, startedAt: number, action: HeroAction): number {
  if (action === "idle") return 0
  const duration = HERO_ACTION_DURATIONS[action]
  if (!Number.isFinite(elapsed) || !Number.isFinite(startedAt)) return 0
  return clamp01((elapsed - startedAt) / duration)
}

/** Three readable phases: wind-up, committed action, and recovery. */
export function heroActionEnvelope(progress: number): number {
  const amount = clamp01(progress)
  if (amount < 0.32) return smoothstep(amount / 0.32)
  if (amount <= 0.68) return 1
  return 1 - smoothstep((amount - 0.68) / 0.32)
}

function fallbackActionProgress(elapsed: number, action: HeroAction): number {
  if (action === "idle") return 0
  const duration = HERO_ACTION_DURATIONS[action]
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0
  return ((safeElapsed % duration) + duration) % duration / duration
}

function copyRotation(target: JointRotation, source: JointRotation, amount: number): void {
  target.x += (source.x - target.x) * amount
  target.y += (source.y - target.y) * amount
  target.z += (source.z - target.z) * amount
}

function applyBowAction(sample: HeroAnimationSample, amount: number, characterId: CharacterId): void {
  const heavy = characterId === "little-john"
  copyRotation(sample.leftArm, rotation(heavy ? -1.32 : -1.48, 0.08, heavy ? 0.34 : 0.22), amount)
  copyRotation(sample.rightArm, rotation(heavy ? -1.08 : -1.25, heavy ? -0.48 : -0.58, heavy ? -0.58 : -0.72), amount)
  copyRotation(sample.leftForearm, rotation(-0.15, 0, 0), amount)
  copyRotation(sample.rightForearm, rotation(heavy ? -0.98 : -1.15, 0, -0.32), amount)
  sample.torso.y += (heavy ? -0.08 : 0.06) * amount
  sample.head.y += 0.14 * amount
  sample.bowDraw = amount
}

function applyRobinVolley(sample: HeroAnimationSample, amount: number): void {
  copyRotation(sample.leftArm, rotation(-1.58, 0.12, 0.38), amount)
  copyRotation(sample.rightArm, rotation(-1.34, -0.7, -0.82), amount)
  copyRotation(sample.leftForearm, rotation(-0.22, 0, 0.08), amount)
  copyRotation(sample.rightForearm, rotation(-1.28, 0.08, -0.4), amount)
  sample.torso.y -= 0.18 * amount
  sample.torso.x -= 0.06 * amount
  sample.head.y += 0.2 * amount
  sample.bowDraw = amount
  sample.showVolleyArrow = amount > 0.08
}

function applyMarianVeil(sample: HeroAnimationSample, amount: number): void {
  copyRotation(sample.leftArm, rotation(-0.42, -0.2, 0.92), amount)
  copyRotation(sample.rightArm, rotation(-0.55, 0.18, -0.98), amount)
  copyRotation(sample.leftForearm, rotation(-0.82, 0.12, 0.12), amount)
  copyRotation(sample.rightForearm, rotation(-0.72, -0.12, -0.12), amount)
  sample.torso.x -= 0.12 * amount
  sample.head.x -= 0.08 * amount
  sample.capePitch -= 0.32 * amount
  sample.capeRoll += 0.18 * amount
}

function applyJohnSweep(sample: HeroAnimationSample, amount: number, progress: number): void {
  const committed = smoothstep((clamp01(progress) - 0.18) / 0.58)
  const sweep = -0.72 + committed * 1.5
  copyRotation(sample.leftArm, rotation(-0.95, -0.34, 0.5), amount)
  copyRotation(sample.rightArm, rotation(-0.82, 0.42, -0.42), amount)
  copyRotation(sample.leftForearm, rotation(-0.7, 0, 0.12), amount)
  copyRotation(sample.rightForearm, rotation(-0.88, 0, -0.1), amount)
  sample.torso.y += sweep * amount
  sample.pelvis.y -= sweep * 0.18 * amount
  sample.leftLeg.x -= 0.28 * amount
  sample.rightLeg.x += 0.2 * amount
  sample.showBow = false
  sample.showHandStaff = amount > 0.05
  sample.showBackStaff = amount <= 0.05
}

function applyMuchSnare(sample: HeroAnimationSample, amount: number): void {
  copyRotation(sample.leftArm, rotation(-0.2, -0.18, 0.34), amount)
  copyRotation(sample.rightArm, rotation(-0.34, 0.22, -0.42), amount)
  copyRotation(sample.leftForearm, rotation(-1.04, 0, 0.12), amount)
  copyRotation(sample.rightForearm, rotation(-1.2, 0, -0.18), amount)
  copyRotation(sample.leftLeg, rotation(-0.82, 0, 0.08), amount)
  copyRotation(sample.rightLeg, rotation(0.28, 0, -0.08), amount)
  copyRotation(sample.leftShin, rotation(1.08, 0, 0), amount)
  copyRotation(sample.rightShin, rotation(0.72, 0, 0), amount)
  sample.torso.x += 0.44 * amount
  sample.bodyY -= 0.04 * amount
  sample.head.x -= 0.18 * amount
  sample.showBow = amount <= 0.08
  sample.showSignatureProp = amount > 0.08
}

function applyDownedPose(sample: HeroAnimationSample, profile: MotionProfile): void {
  sample.bodyY = profile.downedLift
  sample.body = rotation(0.08, 0, 1.18)
  sample.pelvis = rotation(0.16, -0.08, 0.08)
  sample.torso = rotation(0.24, 0.08, -0.08)
  sample.head = rotation(-0.28, -0.18, -0.18)
  sample.leftArm = rotation(-0.72, -0.18, 0.46)
  sample.rightArm = rotation(-0.54, 0.22, -0.38)
  sample.leftForearm = rotation(-0.76, 0, 0.18)
  sample.rightForearm = rotation(-0.92, 0, -0.16)
  sample.leftLeg = rotation(-0.48, 0, 0.12)
  sample.rightLeg = rotation(0.34, 0, -0.12)
  sample.leftShin = rotation(0.82, 0, 0)
  sample.rightShin = rotation(0.58, 0, 0)
  sample.capePitch = -0.2
  sample.capeRoll = 0
  sample.bowDraw = 0
  sample.showBow = true
  sample.showHandStaff = false
  sample.showBackStaff = true
  sample.showSignatureProp = false
  sample.showVolleyArrow = false
}

export function sampleHeroAnimation(input: HeroAnimationInput): HeroAnimationSample {
  const profile = MOTION_PROFILES[input.characterId]
  const motionScale = clamp01(input.motionScale ?? 1)
  const action = input.action ?? "idle"
  const safeElapsed = Number.isFinite(input.elapsed) ? input.elapsed : 0
  const progress = action === "idle"
    ? 0
    : clamp01(input.actionProgress ?? fallbackActionProgress(input.elapsed, action))
  const actionAmount = action === "idle" ? 0 : heroActionEnvelope(progress)
  const walk = input.moving && !input.downed
    ? Math.sin(safeElapsed * profile.cadence) * profile.stride * motionScale
    : 0
  const breathe = Math.sin(safeElapsed * 2.6) * 0.022 * motionScale
  const leftStep = Math.max(0, -walk)
  const rightStep = Math.max(0, walk)
  const sample: HeroAnimationSample = {
    bodyY: Math.abs(walk) * 0.022 + breathe,
    body: rotation(),
    pelvis: rotation(0, input.moving ? -walk * 0.06 : 0, 0),
    torso: rotation(profile.torsoLean, input.moving ? walk * 0.1 : 0, input.moving ? walk * (input.characterId === "much" ? 0.065 : 0.035) : 0),
    head: rotation(0, input.moving ? -walk * 0.065 : Math.sin(safeElapsed * 0.85) * 0.045 * motionScale, input.moving ? -walk * 0.025 : 0),
    leftArm: rotation(-walk * profile.armSwing, 0, 0.08),
    rightArm: rotation(walk * profile.armSwing, 0, -0.08),
    leftForearm: rotation(Math.max(0, walk) * 0.18, 0, 0),
    rightForearm: rotation(Math.max(0, -walk) * 0.18, 0, 0),
    leftLeg: rotation(walk, 0, 0),
    rightLeg: rotation(-walk, 0, 0),
    leftShin: rotation(leftStep * 0.72, 0, 0),
    rightShin: rotation(rightStep * 0.72, 0, 0),
    capePitch: -0.08 - Math.abs(walk) * 0.11,
    capeRoll: input.moving ? -walk * 0.025 : Math.sin(safeElapsed * 1.8) * 0.012 * motionScale,
    bowDraw: 0,
    showBow: true,
    showHandStaff: false,
    showBackStaff: input.characterId === "little-john",
    showSignatureProp: false,
    showVolleyArrow: false,
  }

  if (action === "attack") applyBowAction(sample, actionAmount, input.characterId)
  else if (action === "signature" && input.characterId === "robin") applyRobinVolley(sample, actionAmount)
  else if (action === "signature" && input.characterId === "marian") applyMarianVeil(sample, actionAmount)
  else if (action === "signature" && input.characterId === "little-john") applyJohnSweep(sample, actionAmount, progress)
  else if (action === "signature") applyMuchSnare(sample, actionAmount)

  if (input.downed) applyDownedPose(sample, profile)
  return sample
}
