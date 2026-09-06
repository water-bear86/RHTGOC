import {
  SCROLL_ACHIEVEMENTS,
  scrollLevelProgress,
  type ScrollRecord,
} from "../shared/scroll-record"
import { buildScrollIllumination, illuminationSvg, sealSvg } from "./scroll-illumination"
import type { ScrollCheckpointStatus, ScrollSyncState } from "./scroll-store"

/**
 * The Scroll panel: the player's record, rendered as a document they can read.
 *
 * `buildScrollView` is pure so the whole presentation is testable without a
 * DOM; `renderScrollPanel` only turns that view into elements. Every fact the
 * illumination hints at is also present here as real, selectable text, so the
 * scroll is legible to a screen reader and to a player with images disabled.
 */

export interface ScrollStatLine {
  label: string
  value: string
}

export interface ScrollAchievementLine {
  id: string
  name: string
  description: string
  earned: boolean
  /** 0..1, for the not-yet-earned progress rule. */
  progress: number
  progressLabel: string
}

export interface ScrollChronicleLine {
  id: string
  text: string
  when: string
}

export interface ScrollView {
  outlawName: string
  levelLabel: string
  levelDetail: string
  levelFraction: number
  status: ScrollCheckpointStatus
  statusLabel: string
  /** Short human explanation of what the status means for the player. */
  statusHelp: string
  identity: ScrollStatLine[]
  stats: ScrollStatLine[]
  achievements: ScrollAchievementLine[]
  earnedCount: number
  chronicle: ScrollChronicleLine[]
  /** True when there is nothing to show yet. */
  empty: boolean
}

const STATUS_HELP: Record<ScrollCheckpointStatus, string> = {
  unbound:
    "You are playing free, with no wallet. This record is complete and yours, but it lives only in this browser — export it to keep it.",
  unsealed:
    "Your wallet is connected. Mint a Scroll to anchor this record on Robinhood Chain and carry it between devices.",
  pending: "New deeds are written here and are on their way to the Scroll service. Nothing is lost if you close the game.",
  recorded: "The Scroll service holds this record. It will be sealed on chain at the next checkpoint.",
  sealed: "This record matches the seal on Robinhood Chain exactly.",
  diverged:
    "The seal on chain does not match this record. Your progress is safe on the service; the next checkpoint will correct the seal.",
}

function shortAddress(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function formatWhen(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "—"
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(at).toLocaleDateString("en-GB")
}

function count(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-GB")
}

export function buildScrollView(record: ScrollRecord, sync: ScrollSyncState, now = Date.now()): ScrollView {
  const progress = scrollLevelProgress(record.experience)
  const earned = new Set(record.achievements)

  const identity: ScrollStatLine[] = [
    { label: "Outlaw", value: record.outlawName },
    { label: "Wallet", value: record.wallet ? shortAddress(record.wallet) : "Not bound" },
    // A token id without a bound wallet is meaningless to the player, and
    // reading "#128" beside "Not bound" is just confusing.
    { label: "Scroll", value: record.wallet && record.scrollTokenId ? `#${record.scrollTokenId}` : "Not minted" },
  ]
  if (sync.anchor) {
    identity.push(
      { label: "Checkpoint", value: `v${sync.anchor.version}` },
      { label: "State root", value: `${sync.anchor.stateRoot.slice(0, 10)}…${sync.anchor.stateRoot.slice(-6)}` },
    )
  }
  identity.push({ label: "Last saved", value: sync.syncedAt ? formatWhen(sync.syncedAt, now) : formatWhen(record.updatedAt, now) })
  if (sync.queuedDeeds > 0) {
    identity.push({ label: "Awaiting lodging", value: `${count(sync.queuedDeeds)} ${sync.queuedDeeds === 1 ? "deed" : "deeds"}` })
  }

  const stats: ScrollStatLine[] = [
    { label: "Missions ridden", value: count(record.stats.matches) },
    { label: "Coin returned", value: count(record.stats.coinReturned) },
    { label: "Guards bested", value: count(record.stats.captures) },
    { label: "Allies freed", value: count(record.stats.rescues) },
    { label: "Unseen escapes", value: count(record.stats.cleanEscapes) },
    { label: "Sherwood walked", value: `${count(record.stats.regionsExplored)}/25` },
    { label: "Finest hour", value: record.stats.bestGrade ? `${record.stats.bestGrade} · ${count(record.stats.bestScore)}` : "—" },
    { label: "Largest band", value: record.stats.largestBand > 0 ? `${count(record.stats.largestBand)}` : "—" },
  ]

  const achievements: ScrollAchievementLine[] = SCROLL_ACHIEVEMENTS.map((achievement) => {
    const isEarned = earned.has(achievement.id)
    const value = isEarned ? 1 : Math.max(0, Math.min(1, achievement.progress(record)))
    return {
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      earned: isEarned,
      progress: value,
      progressLabel: isEarned ? "Sealed" : `${Math.floor(value * 100)}%`,
    }
  })

  const chronicle: ScrollChronicleLine[] = [...record.chronicle]
    .reverse()
    .map((entry) => ({ id: entry.id, text: entry.text, when: formatWhen(entry.at, now) }))

  return {
    outlawName: record.outlawName,
    levelLabel: progress.atMax ? `Level ${progress.level} · Legend of Sherwood` : `Level ${progress.level}`,
    levelDetail: progress.atMax
      ? `${count(record.experience)} renown`
      : `${count(progress.intoLevel)} / ${count(progress.neededForNext)} renown to level ${progress.level + 1}`,
    levelFraction: progress.fraction,
    status: sync.status,
    statusLabel: sync.lastError ? `${describeStatus(sync.status)} · ${sync.lastError}` : describeStatus(sync.status),
    statusHelp: STATUS_HELP[sync.status],
    identity,
    stats,
    achievements,
    earnedCount: record.achievements.length,
    chronicle,
    empty: record.chronicle.length === 0 && record.stats.matches === 0,
  }
}

function describeStatus(status: ScrollCheckpointStatus): string {
  switch (status) {
    case "unbound":
      return "Unbound"
    case "unsealed":
      return "Unsealed"
    case "pending":
      return "Pending"
    case "recorded":
      return "Recorded"
    case "sealed":
      return "Sealed"
    case "diverged":
      return "Diverged"
  }
}

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

export interface ScrollPanelElements {
  illumination: HTMLElement
  seal: HTMLElement
  name: HTMLElement
  level: HTMLElement
  levelDetail: HTMLElement
  levelFill: HTMLElement
  status: HTMLElement
  statusHelp: HTMLElement
  identity: HTMLElement
  stats: HTMLElement
  achievements: HTMLElement
  achievementsCount: HTMLElement
  chronicle: HTMLElement
}

function definitionList(target: HTMLElement, lines: readonly ScrollStatLine[]): void {
  target.replaceChildren()
  for (const line of lines) {
    const term = document.createElement("dt")
    term.textContent = line.label
    const detail = document.createElement("dd")
    detail.textContent = line.value
    target.append(term, detail)
  }
}

export function renderScrollPanel(elements: ScrollPanelElements, record: ScrollRecord, sync: ScrollSyncState, now = Date.now()): ScrollView {
  const view = buildScrollView(record, sync, now)
  const illumination = buildScrollIllumination(record, sync.status)

  elements.illumination.innerHTML = illuminationSvg(illumination)
  elements.illumination.setAttribute("aria-hidden", "true")
  elements.seal.innerHTML = sealSvg(illumination.seal)

  elements.name.textContent = view.outlawName
  elements.level.textContent = view.levelLabel
  elements.levelDetail.textContent = view.levelDetail
  elements.levelFill.style.width = `${Math.round(view.levelFraction * 100)}%`

  elements.status.textContent = view.statusLabel
  elements.status.dataset.status = view.status
  elements.statusHelp.textContent = view.statusHelp

  definitionList(elements.identity, view.identity)
  definitionList(elements.stats, view.stats)

  elements.achievementsCount.textContent = `${view.earnedCount}/${view.achievements.length}`
  elements.achievements.replaceChildren()
  for (const achievement of view.achievements) {
    const item = document.createElement("li")
    item.className = achievement.earned ? "scroll-deed earned" : "scroll-deed"
    const name = document.createElement("b")
    name.textContent = achievement.name
    const mark = document.createElement("em")
    mark.textContent = achievement.progressLabel
    const description = document.createElement("small")
    description.textContent = achievement.description
    const rule = document.createElement("i")
    rule.style.width = `${Math.round(achievement.progress * 100)}%`
    const track = document.createElement("span")
    track.className = "scroll-deed-rule"
    track.append(rule)
    item.append(name, mark, description, track)
    elements.achievements.append(item)
  }

  elements.chronicle.replaceChildren()
  if (view.chronicle.length === 0) {
    const empty = document.createElement("li")
    empty.className = "scroll-chronicle-empty"
    empty.textContent = "The scroll is blank. Ride out and it will write itself."
    elements.chronicle.append(empty)
  } else {
    for (const entry of view.chronicle) {
      const item = document.createElement("li")
      const text = document.createElement("span")
      text.textContent = entry.text
      const when = document.createElement("time")
      when.textContent = entry.when
      item.append(text, when)
      elements.chronicle.append(item)
    }
  }

  return view
}
