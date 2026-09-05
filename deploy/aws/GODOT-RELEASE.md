## Godot Web client release

The Three.js lane at `/` remains the known-good fallback. The Godot Web client ships through a **content-addressed, immutable artifact lane** that is entirely orthogonal to the Three.js bucket and the `/assets/*` path: every Godot export is published to `s3://<bucket>/godot/<artifactId>/`, where

```
artifactId = <source-commit-12>-<asset-manifest-hash-12>
```

The `assetManifestHash` is a SHA-256 over the sorted `(path, sha256, bytes)` rows of every exported file, so any changed byte yields a new artifact id. Published bytes are **never overwritten** — publish refuses a prefix collision.

The active candidate is a **mutable pointer** at `s3://<bucket>/godot/current.json` (no-cache) that names the promoted artifact id. Every promotion or rollback is journaled under `s3://<bucket>/godot/history/`.

### Content types and caching

File content types and cache policies are defined in `tools/godot-artifact.mjs` (AWS publish) and mirrored by `shared/release.ts` (`staticCacheControl`, consulted by the room server's static handler). The rules:

| Path | Content-Type | Cache-Control |
| --- | --- | --- |
| `godot/<id>/*.{wasm,pck,js,...}` | per extension | `public, max-age=31536000, immutable` |
| `godot/<id>/*.html` | `text/html; charset=utf-8` | `no-store` |
| `godot/current.json` | `application/json; charset=utf-8` | `no-store` |
| `godot/history/*` | `application/json; charset=utf-8` | `no-store` |
| `godot/*` outside an artifact id | per extension | `public, max-age=3600, must-revalidate` |

Immutability is **only** granted to files under a content-addressed artifact path (`/godot/[0-9a-f]{12}-[0-9a-f]{12}/`). Godot filenames served outside that path (e.g. `/game.wasm`, `/godot/latest/*`) must never be cached immutably — a re-export under the same name would otherwise poison edge caches for a year.

The CloudFront stack applies the isolation policy only to the `/godot/*` behavior; the Three.js lane (`/`) uses a baseline policy that omits COOP/COEP so wallet popups and third-party embeds keep working.

### Cross-origin isolation

The Godot Web export requires `SharedArrayBuffer`, which requires cross-origin isolation. Both the room server (`server/index.ts`) and the CloudFront stack (`deploy/aws/rhtgoc-edge.yaml`) set these headers **only on the Godot lane**:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

The Three.js lane does not receive them — `credentialless` embeds could break existing wallet popups, and only the Godot documents opt in via their own scope.

### Artifact identity and promotion journal

`tools/godot-artifact.mjs` implements the lifecycle:

```bash
# 1. Pack a Godot Web export into an immutable artifact directory.
node tools/godot-artifact.mjs pack --export-dir <godot-export> [--commit SHA] [--out dist-godot]

# 2. Publish the artifact to the primary + staging client buckets.
#    Fails loudly if any object already exists under that artifact prefix;
#    the operator must re-export (new artifact id) instead of overwriting.
node tools/godot-artifact.mjs publish --artifact-dir dist-godot/<id> [--resume]

# 3. Promote (or rollback) by writing godot/current.json + history.
node tools/godot-artifact.mjs promote --artifact-id <commit12-hash12>
node tools/godot-artifact.mjs rollback --artifact-id <commit12-hash12>

# 4. Inspect published artifacts and the active pointer.
node tools/godot-artifact.mjs status
```

The pack step also writes a `manifest.json` into the artifact that lists every file with its `sha256`, `bytes`, and `contentType`. The `publish` step re-verifies the manifest against the actual bytes on upload. The manifest is the source of truth for the release-verify tool.

### Canary switching (client lane)

Godot vs Three.js is not switched by the pointer alone. The pointer points at an artifact inside the **staging** (or production) client bucket; CloudFront's continuous-deployment canary (`tools/aws-edge-release.mjs`) routes weighted traffic between the primary (Three.js) and staging (Godot) distribution. Rollback is therefore deterministic and instant:

```bash
node tools/aws-edge-release.mjs disable       # route 100% to primary (Three.js)
node tools/aws-edge-release.mjs enable 0.05   # 5% to staging (Godot)
node tools/aws-edge-release.mjs set-weight 0.10
node tools/aws-edge-release.mjs status
```

A canary enable is a CloudFormation stack update; a disable is a stack update. Both operate on the existing primary/staging distributions without replacing any previously published (immutable) artifact bytes.

### Public verification

```bash
node tools/godot-release-verify.mjs \
  --origin https://rhtgoc.site \
  --artifact <commit12-hash12> \
  --json evidence.json
```

Verifies, from the public origin outward:

1. `/build-info` reports `buildId`, `commitSha`, `protocolVersion`, `containerImage`, `missionContentHash`.
2. The Three.js lane serves its entry document and hashed asset with correct headers and **no** COOP/COEP.
3. The Godot pointer resolves to the requested artifact id, the manifest is well-formed, and every declared file is fetchable with the exact content type, immutable cache policy, and isolation headers.
4. A `wss://` room handshake creates and joins a room against the promoted server build.

Required checks failing exits non-zero and writes timestamped JSON evidence. `--full` enables content-hash verification for every file (skips files above 16MB by default). `--skip-ws` omits the connectivity check for offline runs.

### Operational notes

- The deploy workflow (`deploy-aws.yml`) stays on the Three.js lane. A Godot lane cutover is a separate, operator-triggered sequence (pack → publish → canary-enable → monitor → promote), never an automatic push-to-main.
- Because artifacts are content-addressed, a reverted commit republishes under its original id, and a forward commit gets a new one. There is no "latest" symlink to drift.
- `godot/current.json` is the only mutable object in the lane; it must always be invalidated on promotion (the tool does this automatically).
- `build-info` exposes the active `protocolVersion` so the verify tool can negotiate the WebSocket handshake without guessing.
