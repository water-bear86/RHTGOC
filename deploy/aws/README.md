# AWS deployment

The production artifact is a single container that serves the Vite build and the Merry Band WebSocket endpoint from one origin. This avoids cross-origin configuration and keeps the alpha architecture understandable.

The playtest is deployed as one AWS Lightsail Container Service node. The room server is intentionally single-instance and in-memory; do not add autoscaling until room state is moved to a shared store.

## Live service

- Service: `sherwood-rebellion`
- Region: `ca-central-1`
- Power: `micro` (1 GB RAM)
- Scale: `1`
- URL: `https://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/`
- Health: `https://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/health`
- WebSocket: `wss://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/rooms`

Required build arguments:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Runtime port: `8080`. Health check: `/health`. WebSocket endpoint: `/rooms`.

Runtime secrets are supplied only to the container deployment, never as Docker build arguments:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Keep them in AWS Secrets Manager or the operator's encrypted password manager and inject them into the container environment. Rotate immediately after suspected disclosure. A deployment without these values remains playable but reports `bandPersistence: false` and `verifiedLeaderboardWrites: false` at `/health`.

## Deploy an update

AWS Lightsail currently expects an AMD64 image. Build with the publishable Supabase values from `.env.local`, export the short-lived AWS browser-login credentials for `lightsailctl`, and push a labeled image:

```bash
aws login --region ca-central-1

set -a
source .env.local
set +a

docker build \
  --platform linux/amd64 \
  --build-arg VITE_SUPABASE_URL \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY \
  -t sherwood-rebellion:VERSION .

eval "$(aws configure export-credentials --format env)"
aws lightsail push-container-image \
  --service-name sherwood-rebellion \
  --label app \
  --image sherwood-rebellion:VERSION \
  --region ca-central-1
```

Use the image reference returned by the push command in a new deployment:

```bash
aws lightsail create-container-service-deployment \
  --service-name sherwood-rebellion \
  --region ca-central-1 \
  --containers '{"app":{"image":":sherwood-rebellion.app.N","ports":{"8080":"HTTP"}}}' \
  --public-endpoint '{"containerName":"app","containerPort":8080,"healthCheck":{"path":"/health","intervalSeconds":10,"timeoutSeconds":5,"healthyThreshold":2,"unhealthyThreshold":2,"successCodes":"200-399"}}'
```

Confirm `RUNNING` and `ACTIVE` before announcing the release:

```bash
aws lightsail get-container-services \
  --service-name sherwood-rebellion \
  --region ca-central-1
```

Then run the health, reconnect, and bounded load checks against the new origin and inspect `/metrics` for persistence failures.

## Rollback

Keep the previous two immutable Lightsail image references. If the new deployment fails health checks, reconnect tests, asset loading, or persistence:

1. Stop promotion and capture the deployment state plus `/health` and `/metrics` output.
2. Create a new deployment using the last known-good image reference and the same runtime secret configuration.
3. Wait until Lightsail reports the rollback deployment `ACTIVE` and the previous deployment is no longer receiving traffic.
4. Verify `/health`, create/join/reconnect, and one mission snapshot from the public origin.
5. If a migration is implicated, leave the database forward-compatible; restore from backup only after a temporary-project restore drill. Do not manually delete production rows.
6. Open an incident issue with the failed image, known-good image, timestamps, trace IDs, and follow-up owner.

Lightsail deployment history is not a substitute for recording exact image references in the GitHub release or milestone notes.
