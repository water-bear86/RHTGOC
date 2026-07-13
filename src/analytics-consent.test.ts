import { describe, expect, it } from "vitest"
import { getProductAnalyticsConsent, PRODUCT_ANALYTICS_CONSENT_KEY, setProductAnalyticsConsent } from "./analytics-consent"

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(PRODUCT_ANALYTICS_CONSENT_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe("product analytics consent", () => {
  it("defaults on while allowing a persistent opt out", () => {
    const storage = memoryStorage()
    expect(getProductAnalyticsConsent(storage)).toBe(true)
    setProductAnalyticsConsent(false, storage)
    expect(getProductAnalyticsConsent(storage)).toBe(false)
  })

  it("only treats the explicit false preference as opted out", () => {
    expect(getProductAnalyticsConsent(memoryStorage("false"))).toBe(false)
    expect(getProductAnalyticsConsent(memoryStorage("true"))).toBe(true)
  })
})
