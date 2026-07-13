export interface RenderCapabilities {
  maxTextureSize: number
  maxTextures: number
  devicePixelRatio: number
  reducedMotion: boolean
}

export interface RenderProfile {
  tier: "degraded" | "standard"
  pixelRatio: number
  shadows: boolean
  motionScale: number
}

export function chooseRenderProfile(capabilities: RenderCapabilities, forceDegraded = false): RenderProfile {
  const degraded = forceDegraded || capabilities.maxTextureSize < 4096 || capabilities.maxTextures < 16
  return {
    tier: degraded ? "degraded" : "standard",
    pixelRatio: degraded ? 1 : Math.min(capabilities.devicePixelRatio, 1.75),
    shadows: !degraded,
    motionScale: capabilities.reducedMotion ? 0 : 1,
  }
}
