# Sherwood Finery (basic vanity catalog)

Cosmetic-only keepsakes for the local outlaw. Sherwood remains free to play;
Finery is optional, wallet-signed, and has zero gameplay effect.

## Catalog and pricing

Three deterministic items shared by the client, server, and database
(`shared/vanity-catalog.ts`):

| Item | Slot | Price |
| --- | --- | --- |
| Fox Plume | accent | 1/2 × base token amount |
| Sherwood Fireflies | motes | 1 × base token amount |
| King's Ransom Trail | trail | 3/2 × base token amount |

"Base token amount" is the existing `TOKEN_ACCESS_AMOUNT` configured for the
Robinhood Chain token payments. Amounts are always computed server-side as
exact integer multipliers over base units (floor division) and delivered to
the client; the client never derives prices from raw multipliers.

## Reuse of the existing token payment stack

- `src/token-access.ts` gained exported helpers (`tokenBackendRequest`,
  `tokenBackendJson`, `sendTokenTransferToTreasury`) that the token-pass claim
  and Finery purchase share. Purchases still use the Robinhood Wallet sign-in
  and the same `eth_sendTransaction` ERC-20 transfer to the configured
  treasury, then report the transaction hash for server verification.
- `server/token-access-service.ts` now exposes
  `resolveTokenPaymentEnvironment()`, the single source of truth for chain id,
  RPC, contract, treasury, decimals, symbol, pass days, and confirmations.
  `TOKEN_CONTRACT_ADDRESS` remains the only game-token-specific contract value
  in a deployment; no addresses are hardcoded anywhere in the feature.

## Server-authoritative purchase and ownership

`POST /api/vanity/purchase` (signed-in wallet identity) verifies, before granting
ownership:

1. the transaction hash format,
2. the network is the configured Robinhood chain,
3. the receipt exists and has the required confirmations,
4. the transaction was sent by the signed-in wallet to the configured ERC-20
   contract,
5. the contract emitted a `Transfer(wallet → treasury)` of at least the item's
   server-computed amount,
6. the hash has not already granted a pass **or** a vanity item (cross-ledger
   replay check in the database).

Only after those checks pass does the `record_vanity_purchase` RPC write the
ledger row and the ownership grant in one transaction. `set_vanity_equipped`
replaces the equipped set from owned rows only. All three tables and both
RPCs are service-role-only behind RLS: `public`, `anon`, and `authenticated`
have no read or write access. Client state can never grant inventory.

## Endpoints

- `GET /api/vanity/state` — browse signed out or signed in; returns catalog,
  server prices, payment envelope, and (when signed in) owned/equipped ids.
- `POST /api/vanity/purchase` — `{ itemId, transactionHash }`, requires wallet
  identity; returns refreshed state.
- `POST /api/vanity/equip` — `{ itemIds }`, requires sign-in; returns refreshed
  state. One item per slot, owned items only.

`/health` and the startup log report `vanityConfigured`.

## UI

A compact pre-play dialog opens from the intro card ("Sherwood Finery ·
cosmetic only"). Signed-out visitors browse the shelf; Buy signs in with the
Robinhood Wallet and then runs the payment flow. Owned items can be equipped
immediately, and equipped state renders on the local character at once.

## Local rendering

`src/vanity-visuals.ts` builds everything procedurally with primitives and the
shared storybook toon material — no textures, external art, or new
dependencies:

- **Fox Plume** — crossed toon feather planes riding each outlaw's head height.
- **Sherwood Fireflies** — a ring of additive green-gold motes orbiting the
  torso.
- **King's Ransom Trail** — fading gold dust motes spawned behind the local
  character while moving (world-space, respects reduced-motion scaling).

Cosmetic meshes are tagged `sherwoodCosmeticOnly` so the character-occlusion
cutout never tints them when the outlaw is behind cover. The sightline test
itself (commit d170347) is untouched.

## Deferred: remote multiplayer visibility

For this basic pass, Finery renders **only on the local character**. Remote
outlaws in online missions do not yet display another player's equipped
Finery, and the local player's Finery is not broadcast to the band. A future
pass can add a `equippedItemIds` field to the multiplayer room-state protocol
and render it through the existing remote character views; no gameplay or
ownership change is required, because ownership/equipment are already
server-authoritative.

## Configuration remaining

Run the migration `supabase/migrations/20260904013551_add_sherwood_finery.sql`
(service role only), then set the token payment environment already used by
the token pass:

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server)
- `ROBINHOOD_RPC_URL`, `ROBINHOOD_CHAIN`
- `TOKEN_CONTRACT_ADDRESS` (the game token), `TOKEN_TREASURY_ADDRESS`,
  `TOKEN_SYMBOL`, `TOKEN_DECIMALS`
- `TOKEN_ACCESS_AMOUNT` — also the Finery base price amount
- `TOKEN_PAYMENT_CONFIRMATIONS`

Until the token environment is set, `/api/vanity/state` still serves the catalog
for signed-out browsing but marks `paymentConfigured: false`, and purchases
respond 503.
