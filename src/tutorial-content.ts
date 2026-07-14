import type { MissionKind } from "../shared/protocol"
import type { CharacterId } from "./simulation"

export type TutorialModuleId = "fieldcraft" | `character:${CharacterId}` | `mission:${MissionKind}`
export type TutorialCompletionRevisions = Partial<Record<TutorialModuleId, number>>
export type TutorialVisualKind = "signals" | "character" | "mission"

export interface TutorialLesson {
  moduleId: TutorialModuleId
  revision: number
  eyebrow: string
  title: string
  body: string
  points: readonly string[]
  visual: TutorialVisualKind
}

export interface TutorialTacticalTip {
  id: `${CharacterId}:${MissionKind}`
  label: string
  body: string
}

export interface TutorialPlan {
  characterId: CharacterId
  missionKind: MissionKind
  lessons: readonly TutorialLesson[]
  tacticalTip: TutorialTacticalTip
  moduleIds: readonly TutorialModuleId[]
}

export const FIELDCRAFT_LESSON: TutorialLesson = Object.freeze({
  moduleId: "fieldcraft",
  revision: 1,
  eyebrow: "FIELDCRAFT · SHARED BY EVERY OUTLAW",
  title: "Map what the band learns—not what the forest hides",
  body: "Every expedition rearranges Sherwood. Dark sectors are unsearched, not empty. The map records ground your band has explored and marks your band has placed; the real target appears only after somebody finds it.",
  points: Object.freeze([
    "1 · DANGER warns the band away from a sector.",
    "2 · TARGET marks something worth checking; it is a suggestion, not proof.",
    "3 · ROUTE proposes a path through the woods.",
    "4 · LOOT calls out coin, supplies, or a useful cache.",
    "5 · REGROUP brings the Merry Band back together.",
  ]),
  visual: "signals",
})

export const CHARACTER_LESSONS: Readonly<Record<CharacterId, TutorialLesson>> = Object.freeze({
  robin: Object.freeze({
    moduleId: "character:robin",
    revision: 1,
    eyebrow: "OUTLAW LESSON · ROBIN HOOD",
    title: "Choose the shot that opens the road",
    body: "Robin is the band's marksman. Keep a clear lane, stun escorts before they crowd the carrier, and use Twin Shot when two threats line up.",
    points: Object.freeze(["You carry six arrows before needing a cache.", "Your Fire action targets the nearest guard in range.", "Your Signature action uses Twin Shot to pin multiple guards."]),
    visual: "character",
  }),
  marian: Object.freeze({
    moduleId: "character:marian",
    revision: 1,
    eyebrow: "OUTLAW LESSON · MAID MARIAN",
    title: "See the danger before it closes",
    body: "Marian is Sherwood's fastest scout. Range ahead, mark what you learn, and use Veil to break pursuit when the band needs breathing room.",
    points: Object.freeze(["Your speed makes you the strongest early scout.", "Use the five band signals to turn reconnaissance into shared knowledge.", "Your Signature action casts Veil and breaks active pursuit."]),
    visual: "character",
  }),
  "little-john": Object.freeze({
    moduleId: "character:little-john",
    revision: 1,
    eyebrow: "OUTLAW LESSON · LITTLE JOHN",
    title: "Carry the weight and hold the line",
    body: "Little John is the vanguard. Stay near the outlaw carrying the objective, move heavy loads efficiently, and make space when guards close in.",
    points: Object.freeze(["You are the band's strongest heavy carrier.", "Guard revives and vulnerable teammates at close range.", "Your Signature action uses Oak Sweep to clear space around you."]),
    visual: "character",
  }),
  much: Object.freeze({
    moduleId: "character:much",
    revision: 1,
    eyebrow: "OUTLAW LESSON · MUCH",
    title: "Turn the Sheriff's road against him",
    body: "Much is the saboteur. Prepare escape lanes, disrupt reinforcements, and make the Sheriff's pursuit run through your traps.",
    points: Object.freeze(["Your Signature action places a Road Snare at your feet.", "Interact can cut a nearby reinforcement signal when the mission exposes one.", "Mark routes and danger before the band commits."]),
    visual: "character",
  }),
})

export const MISSION_LESSONS: Readonly<Record<MissionKind, TutorialLesson>> = Object.freeze({
  "tax-cart": Object.freeze({
    moduleId: "mission:tax-cart",
    revision: 1,
    eyebrow: "MISSION LESSON · THE PEOPLE'S PURSE",
    title: "Find it, stop it, rob it, disappear",
    body: "Search the generated sectors until the tax cart is truly discovered. Scatter its escort, take the crown's coin, then choose an escape and return the taxes to the village fire.",
    points: Object.freeze(["Unsearched sectors contain no guaranteed clue.", "Interact robs the cart only after its escort is controlled.", "Breaking pursuit before delivery keeps the carrier alive."]),
    visual: "mission",
  }),
  "prison-wagon": Object.freeze({
    moduleId: "mission:prison-wagon",
    revision: 1,
    eyebrow: "MISSION LESSON · BREAK THE IRON ROAD",
    title: "Stop the wagon and bring everyone home",
    body: "Choose an interception, halt the moving prison wagon, break its lock, and escort every freed captive to a refuge before the Sheriff's response closes in.",
    points: Object.freeze(["The fallen oak and ford create different interception fights.", "The cage lock must be breached after the escort is scattered.", "A fast outlaw should lead while another protects the captives."]),
    visual: "mission",
  }),
  storehouse: Object.freeze({
    moduleId: "mission:storehouse",
    revision: 1,
    eyebrow: "MISSION LESSON · THE NOTTINGHAM LEDGER",
    title: "Enter quietly, leave before the bells agree",
    body: "Case the tally gate or canal roofline, choose disguise, sabotage, or force, then secure the levy and extract before three alarms turn the storehouse into a trap.",
    points: Object.freeze(["Intel and the ledger are optional but valuable.", "Alarm panels can be sabotaged before they trigger.", "Commit to an extraction route before reinforcements arrive."]),
    visual: "mission",
  }),
})

export const ALL_TUTORIAL_LESSONS: readonly TutorialLesson[] = Object.freeze([
  FIELDCRAFT_LESSON,
  ...Object.values(CHARACTER_LESSONS),
  ...Object.values(MISSION_LESSONS),
])

export const TACTICAL_TIPS: Readonly<Record<`${CharacterId}:${MissionKind}`, TutorialTacticalTip>> = Object.freeze({
  "robin:tax-cart": { id: "robin:tax-cart", label: "ROBIN ON THE PEOPLE'S PURSE", body: "Scout from the edge of guard range, then save Twin Shot for the escort pair blocking the cart." },
  "robin:prison-wagon": { id: "robin:prison-wagon", label: "ROBIN ON THE IRON ROAD", body: "Take the long sightline at the interception and pin escorts before anyone commits to the cage." },
  "robin:storehouse": { id: "robin:storehouse", label: "ROBIN AT THE STOREHOUSE", body: "Cover the chosen entrance from range; use Twin Shot when alarm responders bunch in a doorway." },
  "marian:tax-cart": { id: "marian:tax-cart", label: "MARIAN ON THE PEOPLE'S PURSE", body: "Range ahead, report sectors with band signals, and keep Veil ready for the loaded escape." },
  "marian:prison-wagon": { id: "marian:prison-wagon", label: "MARIAN ON THE IRON ROAD", body: "Scout the chosen interception first, then lead freed captives along the safer refuge line." },
  "marian:storehouse": { id: "marian:storehouse", label: "MARIAN AT THE STOREHOUSE", body: "Use your speed to case alarm panels and optional intel before the band commits to the levy." },
  "little-john:tax-cart": { id: "little-john:tax-cart", label: "LITTLE JOHN ON THE PEOPLE'S PURSE", body: "Take the heavy coin load and use Oak Sweep when pursuit reaches the carrier." },
  "little-john:prison-wagon": { id: "little-john:prison-wagon", label: "LITTLE JOHN ON THE IRON ROAD", body: "Hold the cage while the lock breaks, then anchor the rear guard during the captive escort." },
  "little-john:storehouse": { id: "little-john:storehouse", label: "LITTLE JOHN AT THE STOREHOUSE", body: "Be the band's exit insurance: carry the levy and clear a doorway if stealth collapses." },
  "much:tax-cart": { id: "much:tax-cart", label: "MUCH ON THE PEOPLE'S PURSE", body: "Snare the escape road before the robbery and cut the reinforcement signal when the band commits." },
  "much:prison-wagon": { id: "much:prison-wagon", label: "MUCH ON THE IRON ROAD", body: "Seed the pursuit lane with a snare and mark the refuge route before the cage opens." },
  "much:storehouse": { id: "much:storehouse", label: "MUCH AT THE STOREHOUSE", body: "Sabotage an alarm panel, then trap the exit route the Sheriff is most likely to flood." },
})

export function buildTutorialPlan(
  characterId: CharacterId,
  missionKind: MissionKind,
  completed: TutorialCompletionRevisions = {},
): TutorialPlan | null {
  const candidates = [FIELDCRAFT_LESSON, CHARACTER_LESSONS[characterId], MISSION_LESSONS[missionKind]] as const
  const lessons = candidates.filter((lesson) => (completed[lesson.moduleId] ?? 0) < lesson.revision)
  if (lessons.length === 0) return null
  return {
    characterId,
    missionKind,
    lessons,
    tacticalTip: TACTICAL_TIPS[`${characterId}:${missionKind}`],
    moduleIds: lessons.map((lesson) => lesson.moduleId),
  }
}
