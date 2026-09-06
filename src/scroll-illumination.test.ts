import { describe, expect, it } from "vitest"
import { applyScrollDeed, emptyScrollRecord, type ScrollRecord } from "../shared/scroll-record"
import {
  borderVine,
  buildScrollIllumination,
  ILLUMINATION_HEIGHT,
  ILLUMINATION_WIDTH,
  illuminationSeedSource,
  illuminationSvg,
  sealAppearance,
  sealSvg,
  scrollSeed,
  seededRandom,
} from "./scroll-illumination"
import type { ScrollCheckpointStatus } from "./scroll-store"

const ALL_STATUSES: ScrollCheckpointStatus[] = ["unbound", "unsealed", "pending", "recorded", "sealed", "diverged"]

describe("seeding", () => {
  it("is deterministic for the same input", () => {
    expect(scrollSeed("robin")).toBe(scrollSeed("robin"))
    expect(scrollSeed("robin")).not.toBe(scrollSeed("marian"))
  })

  it("produces values in [0, 1)", () => {
    const random = seededRandom(scrollSeed("sherwood"))
    for (let i = 0; i < 500; i += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it("gives the same sequence for the same seed", () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    expect(Array.from({ length: 10 }, a)).toEqual(Array.from({ length: 10 }, b))
  })

  it("seeds from the wallet when there is one, and the name otherwise", () => {
    const guest = emptyScrollRecord("Will Scarlet")
    expect(illuminationSeedSource(guest)).toBe("guest:will scarlet")
    const bound: ScrollRecord = { ...guest, wallet: "0x" + "a".repeat(40) }
    expect(illuminationSeedSource(bound)).toBe("0x" + "a".repeat(40))
  })
})

describe("border vine", () => {
  it("stays inside the illumination bounds", () => {
    for (const side of [-1, 1] as const) {
      const vine = borderVine(scrollSeed("test"), side, 30)
      for (const leaf of vine.leaves) {
        expect(leaf.x).toBeGreaterThan(0)
        expect(leaf.x).toBeLessThan(ILLUMINATION_WIDTH)
        expect(leaf.y).toBeGreaterThan(0)
        expect(leaf.y).toBeLessThan(ILLUMINATION_HEIGHT)
        expect(leaf.size).toBeGreaterThan(0)
      }
    }
  })

  it("grows denser with level", () => {
    const novice = borderVine(scrollSeed("test"), -1, 1)
    const veteran = borderVine(scrollSeed("test"), -1, 40)
    expect(veteran.leaves.length).toBeGreaterThan(novice.leaves.length)
  })

  it("emits a path that starts with a move command", () => {
    expect(borderVine(1, -1, 5).d.startsWith("M ")).toBe(true)
  })

  it("mirrors: the two sides differ", () => {
    const seed = scrollSeed("mirror")
    expect(borderVine(seed, -1, 10).d).not.toBe(borderVine(seed, 1, 10).d)
  })
})

describe("wax seal", () => {
  it("gives every status a distinct label and colour pair", () => {
    const record = emptyScrollRecord()
    const labels = new Set(ALL_STATUSES.map((status) => sealAppearance(record, status).label))
    expect(labels.size).toBe(ALL_STATUSES.length)
  })

  it("treats unbound, unsealed and diverged as broken seals", () => {
    const record = emptyScrollRecord()
    for (const status of ["unbound", "unsealed", "diverged"] as const) {
      expect(sealAppearance(record, status).broken).toBe(true)
    }
    for (const status of ["pending", "recorded", "sealed"] as const) {
      expect(sealAppearance(record, status).broken).toBe(false)
    }
  })

  it("keeps the same sigil and tilt for one player across statuses", () => {
    const record = emptyScrollRecord("Much")
    const first = sealAppearance(record, "unbound")
    const second = sealAppearance(record, "sealed")
    expect(second.sigil).toBe(first.sigil)
    expect(second.rotation).toBe(first.rotation)
  })

  it("tilts the wax, but only slightly", () => {
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      const { rotation } = sealAppearance(emptyScrollRecord(name), "sealed")
      expect(Math.abs(rotation)).toBeLessThanOrEqual(8)
    }
  })
})

describe("illumination", () => {
  it("is identical for identical records", () => {
    const record = emptyScrollRecord("Marian")
    expect(illuminationSvg(buildScrollIllumination(record, "sealed"))).toBe(
      illuminationSvg(buildScrollIllumination(record, "sealed")),
    )
  })

  it("differs between players", () => {
    const a = buildScrollIllumination(emptyScrollRecord("Robin"), "unbound")
    const b = buildScrollIllumination(emptyScrollRecord("Marian"), "unbound")
    expect(illuminationSvg(a)).not.toBe(illuminationSvg(b))
  })

  it("becomes more decorated as achievements accumulate", () => {
    const plain = buildScrollIllumination(emptyScrollRecord("Robin"), "unbound")
    const decorated = buildScrollIllumination(
      { ...emptyScrollRecord("Robin"), achievements: ["a", "b", "c", "d", "e"] },
      "unbound",
    )
    expect(decorated.flourish).toBeGreaterThan(plain.flourish)
  })

  it("keeps the flourish within range even with an impossible achievement count", () => {
    const record = { ...emptyScrollRecord(), achievements: Array.from({ length: 500 }, (_, i) => `a${i}`) }
    expect(buildScrollIllumination(record, "sealed").flourish).toBe(1)
  })

  it("emits well-formed svg roots", () => {
    const illumination = buildScrollIllumination(
      applyScrollDeed(emptyScrollRecord(), { id: "d1", kind: "clean-escape", at: 1 }),
      "recorded",
    )
    const svg = illuminationSvg(illumination)
    expect(svg.startsWith("<svg ")).toBe(true)
    expect(svg.endsWith("</svg>")).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${ILLUMINATION_WIDTH} ${ILLUMINATION_HEIGHT}"`)
    const seal = sealSvg(illumination.seal)
    expect(seal.startsWith("<svg ")).toBe(true)
    expect(seal.endsWith("</svg>")).toBe(true)
  })

  it("escapes the sigil so it can never inject markup", () => {
    const seal = sealSvg({ fill: "#000", rim: "#111", sigil: '<script>&"', rotation: 0, label: "x", broken: false })
    expect(seal).not.toContain("<script>")
    expect(seal).toContain("&lt;script&gt;&amp;&quot;")
  })
})
