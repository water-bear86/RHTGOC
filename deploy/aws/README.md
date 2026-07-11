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
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `OPS_ADMIN_SECRET`

Keep them in AWS Secrets Manager or the operator's encrypted password manager and inject them into the container environment. Rotate immediately after suspected disclosure. A deployment without these values remains playable but reports `bandPersistence`, `verifiedLeaderboardWrites`, `rescueOfferPersistence`, `contributionPersistence`, `seasonPersistence`, and `socialPersistence` as `false` at `/health`.

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

Use the image reference returned by the push command in a new deployment. Lightsail replaces the complete container configuration on each deployment, so construct the environment explicitly; omitting a key disables that subsystem. Keep the temporary JSON file mode at `0600` and delete it immediately after the API accepts the deployment:

```bash
export IMAGE_REF=:sherwood-rebellion.app.N
export DEPLOY_SPEC="$(mktemp)"
chmod 600 "$DEPLOY_SPEC"
jq -n \
  --arg image "$IMAGE_REF" \
  --arg url "$SUPABASE_URL" \
  --arg publishable "$SUPABASE_PUBLISHABLE_KEY" \
  --arg secret "$SUPABASE_SECRET_KEY" \
  --arg ops "$OPS_ADMIN_SECRET" \
  '{app:{image:$image,environment:{SUPABASE_URL:$url,SUPABASE_PUBLISHABLE_KEY:$publishable,SUPABASE_SECRET_KEY:$secret,OPS_ADMIN_SECRET:$ops},ports:{"8080":"HTTP"}}}' \
  > "$DEPLOY_SPEC"

aws lightsail create-container-service-deployment \
  --service-name sherwood-rebellion \
  --region ca-central-1 \
  --containers "file://$DEPLOY_SPEC" \
  --public-endpoint '{"containerName":"app","containerPort":8080,"healthCheck":{"path":"/health","intervalSeconds":10,"timeoutSeconds":5,"healthyThreshold":2,"unhealthyThreshold":2,"successCodes":"200-399"}}'

rm -f "$DEPLOY_SPEC"
unset DEPLOY_SPEC SUPABASE_SECRET_KEY OPS_ADMIN_SECRET
```

Confirm `RUNNING` and `ACTIVE` before announcing the release. The status query must select only non-secret deployment fields; never dump the complete service object or `currentDeployment.containers.environment` into a terminal transcript:

```bash
npm run ops:aws-status
```

The checked-in command owns the field-limited query and rejects responses containing an
`environment` map or a known secret name. Its regression test is part of `npm test`. Do not
replace it with an unfiltered `get-container-services` call, including during incident response.

Then run the health, reconnect, and bounded load checks against the new origin and inspect `/metrics` for persistence failures. A persistence-enabled release is not accepted until `/health` reports all six persistence flags true and one authenticated production mission proves the band-history and verified-leaderboard write paths.

## Rollback

Keep the previous two immutable Lightsail image references. If the new deployment fails health checks, reconnect tests, asset loading, or persistence:

1. Stop promotion and capture the deployment state plus `/health` and `/metrics` output.
2. Create a new deployment using the last known-good image reference and the same runtime secret configuration.
3. Wait until Lightsail reports the rollback deployment `ACTIVE` and the previous deployment is no longer receiving traffic.
4. Verify `/health`, create/join/reconnect, and one mission snapshot from the public origin.
5. If a migration is implicated, leave the database forward-compatible; restore from backup only after a temporary-project restore drill. Do not manually delete production rows.
6. Open an incident issue with the failed image, known-good image, timestamps, trace IDs, and follow-up owner.

Lightsail deployment history is not a substitute for recording exact image references in the GitHub release or milestone notes.
