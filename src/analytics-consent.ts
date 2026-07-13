export const PRODUCT_ANALYTICS_CONSENT_KEY = "sherwood:product-analytics"

type AnalyticsStorage = Pick<Storage, "getItem" | "setItem">

function availableStorage(): AnalyticsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

export function getProductAnalyticsConsent(storage: AnalyticsStorage | null = availableStorage()): boolean {
  if (!storage) return true
  try {
    return storage.getItem(PRODUCT_ANALYTICS_CONSENT_KEY) !== "false"
  } catch {
    return true
  }
}

export function setProductAnalyticsConsent(consented: boolean, storage: AnalyticsStorage | null = availableStorage()): void {
  if (!storage) return
  try {
    storage.setItem(PRODUCT_ANALYTICS_CONSENT_KEY, consented ? "true" : "false")
  } catch {
    // Privacy controls remain usable even when storage is blocked by the browser.
  }
}
