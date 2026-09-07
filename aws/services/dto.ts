import type { PlayerRecord } from "./domain.js";

const iso = (seconds: number | null): string | null =>
  seconds === null ? null : new Date(seconds * 1000).toISOString();

const checkpointStatus = (status: PlayerRecord["checkpointStatus"]) => {
  switch (status) {
    case "idle":
    case "confirmed":
      return "synced" as const;
    case "pending":
    case "queued":
      return "pending" as const;
    case "submitting":
      return "submitting" as const;
    case "submitted":
    case "retrying":
      return "confirming" as const;
    case "failed":
      return "failed" as const;
  }
};

export function checkpointDto(player: PlayerRecord) {
  return {
    version: player.checkpointedVersion,
    stateRoot: player.checkpointedRoot ?? (`0x${"00".repeat(32)}` as `0x${string}`),
    checkpointedAt: iso(player.checkpointedAt),
    transactionHash: player.checkpointTransactionHash,
    status: checkpointStatus(player.checkpointStatus),
    pendingVersion: player.state.version > player.checkpointedVersion ? player.state.version : null,
    dirtySince: iso(player.firstUncheckpointedAt),
    lastAttemptAt: iso(player.lastCheckpointAttemptAt),
    errorCode: player.checkpointErrorCode,
  };
}

export function playerStateDto(player: PlayerRecord) {
  return {
    wallet: player.wallet,
    scrollTokenId: player.state.scrollTokenId,
    schemaVersion: player.state.schemaVersion,
    stateVersion: player.state.version,
    level: player.state.level,
    experience: player.state.experience,
    achievements: player.state.achievements,
    fineries: player.state.fineries,
    equipment: player.state.equipment,
    unlocks: player.state.unlocks,
    stats: player.state.stats,
    canonicalHash: player.canonicalHash,
    stateRoot: player.stateRoot,
    updatedAt: new Date(player.updatedAt * 1000).toISOString(),
    checkpoint: checkpointDto(player),
  };
}

export function playerSummaryDto(player: PlayerRecord, verified: boolean) {
  return {
    wallet: player.wallet,
    scrollTokenId: player.state.scrollTokenId,
    schemaVersion: player.state.schemaVersion,
    stateVersion: player.state.version,
    level: player.state.level,
    achievements: player.state.achievements,
    fineries: player.state.fineries,
    equippedItemIds: Object.values(player.state.equipment).filter((value): value is string => value !== null),
    canonicalHash: player.canonicalHash,
    stateRoot: player.stateRoot,
    checkpoint: checkpointDto(player),
    verified,
  };
}
