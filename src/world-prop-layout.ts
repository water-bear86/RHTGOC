import type { ComposedSettlement, ComposedWorld, SettlementKind } from "../shared/world-composer"

export const MEDIEVAL_PROP_NAMES = [
  "Prop_Well",
  "Prop_Signpost",
  "Prop_Haystack",
  "Prop_Barrel",
  "Prop_Chest",
  "Prop_Box",
  "Prop_Bench",
  "Prop_Bucket",
  "Prop_Firewood",
  "Prop_Pot",
] as const

export type MedievalPropName = typeof MEDIEVAL_PROP_NAMES[number]

export interface MedievalPropPlacement {
  name: MedievalPropName
  position: { x: number; z: number }
  rotation: number
  settlementId: string
}

interface LocalProp {
  name: MedievalPropName
  along: number
  side: number
  turn: number
}

const PROP_TEMPLATES: Record<SettlementKind, readonly LocalProp[]> = {
  "forest-village": [
    { name: "Prop_Well", along: 0, side: 2.85, turn: 0 },
    { name: "Prop_Signpost", along: -4.1, side: -2.55, turn: 0.2 },
    { name: "Prop_Bench", along: 3.6, side: 2.75, turn: Math.PI },
  ],
  "outlaw-hamlet": [
    { name: "Prop_Firewood", along: -3.5, side: 2.8, turn: Math.PI / 2 },
    { name: "Prop_Pot", along: 0.2, side: -2.65, turn: 0.35 },
    { name: "Prop_Chest", along: 3.8, side: 2.85, turn: -0.2 },
  ],
  "sheriff-post": [
    { name: "Prop_Haystack", along: -3.8, side: 2.95, turn: Math.PI / 2 },
    { name: "Prop_Barrel", along: 0.4, side: -2.7, turn: 0.1 },
    { name: "Prop_Box", along: 3.7, side: 2.8, turn: -0.25 },
  ],
}

function worldPlacement(settlement: ComposedSettlement, prop: LocalProp): MedievalPropPlacement {
  const cosine = Math.cos(settlement.streetHeading)
  const sine = Math.sin(settlement.streetHeading)
  return {
    name: prop.name,
    position: {
      x: settlement.center.x + cosine * prop.along + sine * prop.side,
      z: settlement.center.z - sine * prop.along + cosine * prop.side,
    },
    rotation: settlement.streetHeading + prop.turn,
    settlementId: settlement.id,
  }
}

/** Places a small, readable prop vignette inside each composed settlement. */
export function createMedievalPropLayout(world: ComposedWorld): readonly MedievalPropPlacement[] {
  return world.settlements.flatMap((settlement) => (
    PROP_TEMPLATES[settlement.kind].map((prop) => worldPlacement(settlement, prop))
  ))
}
