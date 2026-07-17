import type { MissionEvent, PingKind } from "../shared/protocol"
import type { AudioCueId } from "./audio-cues"
import type { PresentationChannel, PresentationPriority } from "./presentation-events"

export interface GameplayPresentationStyle {
  channel: PresentationChannel
  priority: PresentationPriority
  cue?: AudioCueId
  lifetimeSeconds?: number
}

const CRITICAL_THREATS = new Set<MissionEvent["type"]>([
  "alarm_triggered",
  "reinforcement_arrived",
  "player_downed",
  "player_captured",
  "mission_failed",
])

const IMPORTANT_THREATS = new Set<MissionEvent["type"]>([
  "escort_blocking",
  "player_hit",
  "trap_triggered",
])

const CRITICAL_REWARDS = new Set<MissionEvent["type"]>([
  "mission_succeeded",
])

const IMPORTANT_REWARDS = new Set<MissionEvent["type"]>([
  "loot_delivered",
  "captives_freed",
  "captive_extracted",
  "cache_looted",
  "ledger_stolen",
  "extraction_reached",
  "player_revived",
  "vote_resolved",
])

const IMPORTANT_OBJECTIVES = new Set<MissionEvent["type"]>([
  "phase_changed",
  "route_selected",
  "cart_robbed",
  "wagon_intercepted",
  "lock_breached",
  "alarm_sabotaged",
  "disguise_acquired",
  "intel_found",
  "reinforcement_sabotaged",
])

export function presentationForMissionEvent(type: MissionEvent["type"]): GameplayPresentationStyle {
  if (CRITICAL_THREATS.has(type)) {
    return { channel: "threat", priority: "critical", cue: "ui.warning", lifetimeSeconds: 4 }
  }
  if (IMPORTANT_THREATS.has(type)) {
    return { channel: "threat", priority: "important", cue: "ui.warning", lifetimeSeconds: 3 }
  }
  if (CRITICAL_REWARDS.has(type)) {
    return { channel: "reward", priority: "critical", cue: "ui.confirm", lifetimeSeconds: 4 }
  }
  if (IMPORTANT_REWARDS.has(type)) {
    return { channel: "reward", priority: "important", cue: "ui.confirm", lifetimeSeconds: 3 }
  }
  if (IMPORTANT_OBJECTIVES.has(type)) {
    return { channel: "objective", priority: "important", cue: "ui.notice", lifetimeSeconds: 3 }
  }
  if (type === "ping_sent" || type === "loot_transferred" || type === "ally_protected") {
    return { channel: "party", priority: "routine" }
  }
  return { channel: "action", priority: "routine" }
}

export function cueForPing(kind: PingKind): AudioCueId {
  return `ping.${kind}`
}
