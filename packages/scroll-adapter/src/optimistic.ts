import { CheckpointStatus, type PlayerState, type ProgressMutation } from "./types.js"

function pendingCheckpoint(state: PlayerState, pendingVersion: number): PlayerState["checkpoint"] {
  return {
    ...state.checkpoint,
    status: CheckpointStatus.Pending,
    pendingVersion,
    dirtySince: state.checkpoint.dirtySince ?? new Date().toISOString(),
    errorCode: null,
  }
}

export function applyOptimisticMutation(state: PlayerState, mutation: ProgressMutation): PlayerState {
  const nextVersion = state.stateVersion + 1
  if (mutation.kind === "select_equipment") {
    return {
      ...state,
      stateVersion: nextVersion,
      equipment: {
        ...state.equipment,
        primary: mutation.itemIds[0] ?? null,
        secondary: mutation.itemIds[1] ?? null,
      },
      updatedAt: new Date().toISOString(),
      checkpoint: pendingCheckpoint(state, nextVersion),
    }
  }
  // Match rewards and offline-run results remain provisional until the server
  // validates its authoritative receipt or deterministically replays the run.
  return {
    ...state,
    stateVersion: nextVersion,
    updatedAt: new Date().toISOString(),
    checkpoint: pendingCheckpoint(state, nextVersion),
  }
}

export function isSafelyRebasable(mutation: ProgressMutation): boolean {
  return mutation.kind === "select_equipment"
}
