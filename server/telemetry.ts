export class Telemetry {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private startedAt = Date.now()

  increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount)
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value)
  }

  snapshot(): { uptimeSeconds: number; counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries([...this.counters.entries()].sort()),
      gauges: Object.fromEntries([...this.gauges.entries()].sort()),
    }
  }

  reset(now = Date.now()): void {
    this.counters.clear()
    this.gauges.clear()
    this.startedAt = now
  }
}

export function structuredLog(
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log
  writer(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }))
}
