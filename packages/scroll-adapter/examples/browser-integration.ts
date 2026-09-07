import {
  CheckpointStatus,
  createScrollAdapter,
  type EvmAddress,
  type ScrollWalletProvider,
} from "@robinhood-game/scroll-adapter"

declare const connectedWallet: { address: EvmAddress; provider: ScrollWalletProvider } | null

const adapter = createScrollAdapter({
  apiBaseUrl: "https://scroll-api.example.invalid",
  chainId: 46630,
  ...(connectedWallet ? { walletProvider: connectedWallet.provider } : {}),
  onCheckpointStatus(checkpoint) {
    if (checkpoint.status === CheckpointStatus.Failed) {
      // Present a retry affordance without pausing the active game session.
      console.warn("Scroll checkpoint needs attention", checkpoint.errorCode)
    }
  },
})

if (connectedWallet) {
  const state = await adapter.getPlayerState(connectedWallet.address)
  const optimistic = adapter.saveProgress(connectedWallet.address, {
    kind: "select_equipment",
    itemIds: ["ironwood_bow", "buckler"],
  })
  console.log(state.stateVersion, optimistic.localState.stateVersion)
} else {
  console.log("Guest play remains available without a Scroll or wallet")
}
