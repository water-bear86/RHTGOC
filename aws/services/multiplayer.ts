import type { ChainClient, PlayerPersistence, StateCorePort } from "./ports.js";

export type MultiplayerVerification =
  | { status: "verified"; wallet: string; tokenId: string; state: unknown; allowedEquipment: string[]; allowedUnlocks: string[] }
  | { status: "quarantine"; wallet: string; reason: "missing_scroll" | "root_mismatch" | "invalid_local_commitment" }
  | { status: "unavailable"; wallet: string; reason: "rpc_unavailable" };

export class MultiplayerVerifier {
  constructor(
    private readonly persistence: PlayerPersistence,
    private readonly core: StateCorePort,
    private readonly chain: ChainClient,
  ) {}

  async verify(wallet: string): Promise<MultiplayerVerification> {
    const player = await this.persistence.getPlayer(wallet);
    if (!player?.state.scrollTokenId) return { status: "quarantine", wallet, reason: "missing_scroll" };
    const local = this.core.commitment(player.state);
    if (local.root !== player.stateRoot) return { status: "quarantine", wallet, reason: "invalid_local_commitment" };
    try {
      const checkpoint = await this.chain.getCheckpoint(player.state.scrollTokenId);
      if (
        checkpoint.version !== player.state.version ||
        checkpoint.stateRoot !== player.stateRoot ||
        checkpoint.version !== player.checkpointedVersion ||
        checkpoint.stateRoot !== player.checkpointedRoot
      ) {
        return { status: "quarantine", wallet, reason: "root_mismatch" };
      }
      return {
        status: "verified",
        wallet,
        tokenId: player.state.scrollTokenId,
        state: player.state,
        allowedEquipment: Object.values(player.state.equipment).filter((value): value is string => value !== null),
        allowedUnlocks: [...player.state.unlocks],
      };
    } catch {
      return { status: "unavailable", wallet, reason: "rpc_unavailable" };
    }
  }
}
