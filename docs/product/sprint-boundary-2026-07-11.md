# Sprint boundary — 2026-07-11

Implementation is paused before the next sprint. This record separates live production, pushed M8 work, and the uncommitted local worktree so that review, release, and planning do not blur together.

## Status at the pause

| Plane | Revision | What is true |
| --- | --- | --- |
| Live production | M7 deployment | The permanent AWS origin is playable. Protocol 9 is healthy, but all six persistence flags report `false`. The deployed source commit is not yet exposed by `/health`. |
| Pushed M8 branch | `agent/m8-storybook-art` at `523ac3f` | Draft PR [#38](https://github.com/water-bear86/sherwood-rebellion/pull/38) contains the asset-gate checkpoint and core restrained cel shading. It is not deployed. |
| Local worktree | Uncommitted | Village asset/collision staging is prepared but not connected to `src/main.ts`. No cottage or wagon appears in gameplay. |

The user-visible playtest therefore remains M7. M8 screenshots or local browser evidence must not be described as production behavior.

## Pushed M8 checkpoints

### Asset foundation — `c090bbf`

- Manifest v2 records provenance, licensing basis, hashes, measured runtime costs, collision, and LOD contracts.
- Robin Ranger is a deterministic 2,291,552-byte GLB with bow, quiver, one skin, three named clips, a grounded pivot, six stored primitive submissions, and SHA-256 `2226ac568499ac922bfda426d181adcb4d4553e600cb2544320549932ea27b75`.
- The current checked-in artifacts pass the existing asset tests and production build.

Issue #35 was reopened at the boundary because the gate can be strengthened without rejecting the healthy artifacts:

1. Run a lockfile-pinned Khronos validator inside `npm run validate:assets` and reject falsified accessor bounds.
2. Bind license evidence bytes with SHA-256 and validate the declared license expression.
3. Count actual Three.js submissions for double-sided transparent materials or force/test single-pass glass.
4. Lock conversion and validation tools in `devDependencies`; do not fetch executable tooling through `npx --yes` during the gate.
5. Make source fingerprints and repository-root output portable across platforms and working directories.

### Storybook rendering — `523ac3f`

- Lit standard/physical materials pass through a shared four-step toon adapter while unlit markers remain unlit.
- Skinned heroes, texture sharing, transparency, gameplay recoloring, material arrays, shadow behavior, and disposal have focused coverage.
- Standard and forced-degraded profiles stay inside the current draw/triangle budgets in the tested scenes.
- Robin movement/archery and Marian's Veil fade/restore were browser-tested without console errors.

Issue #36 remains open until village-route visual QA, resize, and WebGL context loss/restoration pass in both render profiles.

## Prepared locally, not shipped

The paused worktree contains:

- `sherwood-village-slice.glb`: 677,248 bytes; SHA-256 `9af770b514072dd55d13c29ffd95b4e1b39659e8baaf17b68e32ee80f4b150eb`.
- Twelve directly curated roots from the Quaternius Medieval Village MegaKit.
- 5,410 triangles, seven materials, sixteen embedded 512-pixel WebP textures, and no external resources.
- Genuine CC0 1.0 evidence with SHA-256 `ec6fd5004514cb0515a7dc1065f474644d31698861597b32e1745945ffec71de`.
- A clean Khronos report for the current candidate.
- Client helpers for exact catalog cloning plus shared rotated-cottage collision integrated locally into solo simulation, the mission server, and public-hub movement.

Important limits:

- `src/village-assets.ts` is not imported by `src/main.ts`.
- Client multiplayer prediction does not yet share the authored collision resolver.
- Two double-sided transparent window primitives may make the actual cottage submission count 23 rather than the stored primitive count of 21.
- The builder still needs a lockfile-pinned toolchain and portable source/output handling.
- Issue #37 remains open; this candidate is not a production asset until runtime integration and full browser QA pass.

The supplied `Free Sample` pack remains rejected: no license evidence, excessive geometry for several pieces, unknown scale/pivot assumptions, and worse wagon/crate costs than the licensed CC0 kit. No source files from that pack belong in `public/`.

## Production release blockers

### Persistent systems

The live `/health` endpoint was checked at this boundary and reports:

- `bandPersistence: false`
- `verifiedLeaderboardWrites: false`
- `rescueOfferPersistence: false`
- `contributionPersistence: false`
- `seasonPersistence: false`
- `socialPersistence: false`

The permanent playtest remains usable, but it cannot claim durable band/social/campaign progression or verified ranked submissions. Issues #9 and #10 require the server-only `SUPABASE_SECRET_KEY` plus authenticated end-to-end production proof.

### Operations and secret handling

Issue #14 remains open. Before the next deployment:

- rotate the operator secret;
- use field-limited AWS status queries that never return container environment maps;
- expose immutable source identity through `/health` or release metadata;
- prove all six persistence flags, reconnects, and one authenticated mission write path;
- run the restore drill only in a temporary project after explicit approval of its hourly cost.

No credential value belongs in commits, screenshots, logs, issue comments, command transcripts, or this document.

## Next sprint entry gate

M9 is planned but not started. Implementation begins only after:

- #35, #36, and #37 close and M8 is reviewed;
- stacked PRs are reconciled into a traceable mainline;
- #9, #10, and #14 pass production activation and operations proof;
- the deployed image can be tied to an immutable Git commit;
- the dirty worktree is intentionally checkpointed or discarded by file, never swept into a release accidentally.

## M9 issue order

Milestone: [M9 · Deeper Sherwood Public Alpha](https://github.com/water-bear86/sherwood-rebellion/milestone/9)

1. #39 — releasable mainline and automated promotion gate.
2. #40 — five-minute Practice Grove.
3. #41 — hero technique chains and cooperative combo mastery.
4. #42 — readable stealth, sound, and guard investigation.
5. #43 — cooperative planning table with route voting.
6. #44 — data-driven regional world composer.
7. #45 — Nottingham Market tax-ledger raid.
8. #46 — role-aware opt-in public-campfire matchmaking.
9. #47 — verified run replays and privacy-safe challenge codes.
10. #48 — co-op accessibility assists and fair scoring contract.
11. #49 — runtime performance and network budgets in CI.
12. #50 — instrumented public-alpha playtest and tuning report.

The M9 exit gate is evidence, not feature count: first-time players learn quickly, returning bands demonstrate deeper mastery, accessibility and degraded rendering hold, production state is trustworthy, and real playtest results become the ranked M10 backlog.
