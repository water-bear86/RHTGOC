import type { BrowserFamily, ClientDiagnosticCode, RenderProfile } from "../shared/protocol"

export interface ClientDiagnostic {
  type: "client_diagnostic"
  code: ClientDiagnosticCode
  fingerprint?: string
  renderProfile: RenderProfile
  browserFamily: BrowserFamily
  browserMajor?: number
}

export function browserProfile(userAgent: string): { browserFamily: BrowserFamily; browserMajor?: number } {
  const candidates: Array<[BrowserFamily, RegExp]> = [
    ["firefox", /(?:Firefox|FxiOS)\/(\d{1,3})/i],
    ["chromium", /(?:Chrome|Chromium|CriOS)\/(\d{1,3})/i],
    ["safari", /Version\/(\d{1,3}).*Safari\//i],
  ]
  for (const [browserFamily, pattern] of candidates) {
    const match = userAgent.match(pattern)
    if (match) return { browserFamily, browserMajor: Number(match[1]) }
  }
  return { browserFamily: "other" }
}

export class DiagnosticRateLimiter {
  private readonly lastSentAt = new Map<ClientDiagnosticCode, number>()

  constructor(private readonly intervalMs = 10_000) {}

  allow(code: ClientDiagnosticCode, now = performance.now()): boolean {
    const lastSentAt = this.lastSentAt.get(code)
    if (lastSentAt !== undefined && now - lastSentAt < this.intervalMs) return false
    this.lastSentAt.set(code, now)
    return true
  }
}

async function sha256(value: string): Promise<string | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined
  const bytes = new TextEncoder().encode(value.slice(0, 16_384))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function fingerprintSource(value: unknown): string | null {
  if (value instanceof Error) return `${value.name}\n${value.stack ?? value.message}`
  if (typeof value === "string") return value
  if (value && typeof value === "object") return Object.prototype.toString.call(value)
  return value == null ? null : typeof value
}

export class ClientDiagnosticReporter {
  private readonly limiter = new DiagnosticRateLimiter()
  private readonly browser = browserProfile(typeof navigator === "undefined" ? "" : navigator.userAgent)
  private lastFrameAt = 0

  constructor(
    private readonly send: (diagnostic: ClientDiagnostic) => void,
    private readonly getRenderProfile: () => RenderProfile,
  ) {}

  async report(code: ClientDiagnosticCode, value?: unknown): Promise<void> {
    if (!this.limiter.allow(code)) return
    const source = fingerprintSource(value)
    const fingerprint = source ? await sha256(source) : undefined
    this.send({ type: "client_diagnostic", code, fingerprint, renderProfile: this.getRenderProfile(), ...this.browser })
  }

  observeFrame(timestamp: number): void {
    if (this.lastFrameAt > 0 && timestamp - this.lastFrameAt >= 1_500) void this.report("frame_stall")
    this.lastFrameAt = timestamp
  }

  resetFrameClock(): void {
    this.lastFrameAt = 0
  }

  installWindowHandlers(target: Window = window): () => void {
    const onError = (event: ErrorEvent) => void this.report("uncaught_error", event.error ?? event.message)
    const onRejection = (event: PromiseRejectionEvent) => void this.report("unhandled_rejection", event.reason)
    target.addEventListener("error", onError)
    target.addEventListener("unhandledrejection", onRejection)
    return () => {
      target.removeEventListener("error", onError)
      target.removeEventListener("unhandledrejection", onRejection)
    }
  }
}
