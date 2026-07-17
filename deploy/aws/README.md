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

The player-facing client is separate from the container origin. `rhtgoc.site` serves
the browser build from the private primary S3 bucket behind CloudFront, while dynamic
routes are forwarded to Lightsail. A production release must deploy both targets with
the same `BUILD_ID`.

## GitHub production deployment

Pushes to `main` run `.github/workflows/deploy-aws.yml`. The job tests the commit,
builds one AMD64 container, extracts the matching browser artifact from that image,
deploys the server to Lightsail, publishes the client to S3, invalidates CloudFront,
and verifies that both public halves report the same build. Before cutover it captures
the current Lightsail spec and S3 object versions; a failed promotion restores both.
Successful releases retain the active Lightsail image plus two rollback images.

AWS authentication uses GitHub OIDC and short-lived credentials. Do not create
`AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` repository secrets. Provision the
dedicated role once:

```bash
aws cloudformation deploy \
  --stack-name sherwood-rhtgoc-github-deploy \
  --template-file deploy/aws/rhtgoc-github-deploy-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

The GitHub `production` environment must allow deployments only from `main` and must
define these environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_REOWN_PROJECT_ID`
- `VITE_ROBINHOOD_CHAIN`

These are publishable Vite settings embedded in the browser bundle. Runtime secrets
remain in the Lightsail deployment environment. The workflow copies that environment
through a mode-`0600` temporary file, changes only the image and build identifiers,
and deletes the file before the job exits. It never writes the runtime environment to
the Actions log.

Required build arguments:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_REOWN_PROJECT_ID`
- `VITE_ROBINHOOD_CHAIN`
- `BUILD_ID` (the immutable release ID shared by the built client and room process)

Runtime port: `8080`. Readiness check: `/ready`. Diagnostic health: `/health`. WebSocket endpoint: `/rooms`.

Runtime secrets are supplied only to the container deployment, never as Docker build arguments:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `OPS_ADMIN_SECRET`
- `ROBINHOOD_CHAIN`
- `ROBINHOOD_RPC_URL`
- `TOKEN_CONTRACT_ADDRESS`
- `TOKEN_TREASURY_ADDRESS`
- `TOKEN_SYMBOL`
- `TOKEN_DECIMALS`
- `TOKEN_ACCESS_AMOUNT`
- `TOKEN_ACCESS_DAYS`
- `TOKEN_PAYMENT_CONFIRMATIONS`
- `PUBLIC_ORIGIN`
- `TOKEN_ACCESS_GATE_ENABLED`
- `BUILD_ID`
- `GAMEPLAY_ANALYTICS_ENABLED`
- `PUBLIC_CAMP_CHAT_ENABLED`

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
  --build-arg VITE_REOWN_PROJECT_ID \
  --build-arg VITE_ROBINHOOD_CHAIN \
  --build-arg BUILD_ID="$VERSION" \
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
  --arg chain "$ROBINHOOD_CHAIN" \
  --arg rpc "$ROBINHOOD_RPC_URL" \
  --arg contract "$TOKEN_CONTRACT_ADDRESS" \
  --arg treasury "$TOKEN_TREASURY_ADDRESS" \
  --arg symbol "$TOKEN_SYMBOL" \
  --arg decimals "$TOKEN_DECIMALS" \
  --arg amount "$TOKEN_ACCESS_AMOUNT" \
  --arg days "$TOKEN_ACCESS_DAYS" \
  --arg confirmations "$TOKEN_PAYMENT_CONFIRMATIONS" \
  --arg origin "$PUBLIC_ORIGIN" \
  --arg gate "$TOKEN_ACCESS_GATE_ENABLED" \
  --arg build "$VERSION" \
  --arg analytics "$GAMEPLAY_ANALYTICS_ENABLED" \
  --arg camp_chat "$PUBLIC_CAMP_CHAT_ENABLED" \
  '{app:{image:$image,environment:{SUPABASE_URL:$url,SUPABASE_PUBLISHABLE_KEY:$publishable,SUPABASE_SECRET_KEY:$secret,OPS_ADMIN_SECRET:$ops,ROBINHOOD_CHAIN:$chain,ROBINHOOD_RPC_URL:$rpc,TOKEN_CONTRACT_ADDRESS:$contract,TOKEN_TREASURY_ADDRESS:$treasury,TOKEN_SYMBOL:$symbol,TOKEN_DECIMALS:$decimals,TOKEN_ACCESS_AMOUNT:$amount,TOKEN_ACCESS_DAYS:$days,TOKEN_PAYMENT_CONFIRMATIONS:$confirmations,PUBLIC_ORIGIN:$origin,TOKEN_ACCESS_GATE_ENABLED:$gate,BUILD_ID:$build,GAMEPLAY_ANALYTICS_ENABLED:$analytics,PUBLIC_CAMP_CHAT_ENABLED:$camp_chat},ports:{"8080":"HTTP"}}}' \
  > "$DEPLOY_SPEC"

aws lightsail create-container-service-deployment \
  --service-name sherwood-rebellion \
  --region ca-central-1 \
  --containers "file://$DEPLOY_SPEC" \
  --public-endpoint '{"containerName":"app","containerPort":8080,"healthCheck":{"path":"/ready","intervalSeconds":10,"timeoutSeconds":5,"healthyThreshold":2,"unhealthyThreshold":2,"successCodes":"200-299"}}'

rm -f "$DEPLOY_SPEC"
unset DEPLOY_SPEC SUPABASE_SECRET_KEY OPS_ADMIN_SECRET ROBINHOOD_RPC_URL
```

Confirm `RUNNING` and `ACTIVE` before announcing the release. The status query must select only non-secret deployment fields; never dump the complete service object or `currentDeployment.containers.environment` into a terminal transcript:

```bash
npm run ops:aws-status
```

The checked-in command owns the field-limited query and rejects responses containing an
`environment` map or a known secret name. Its regression test is part of `npm test`. Do not
replace it with an unfiltered `get-container-services` call, including during incident response.

Then run the health, reconnect, and bounded load checks against the new origin and inspect `/metrics` for persistence failures. A persistence-enabled release is not accepted until `/health` reports all six persistence flags true and one authenticated production mission proves the band-history and verified-leaderboard write paths. Keep `PUBLIC_CAMP_CHAT_ENABLED=false` until the chat-report migration ledger, database advisors, retention RPC, and authenticated report proof are complete; after activation, `publicCampChat` must also report `true`.

Keep `TOKEN_ACCESS_GATE_ENABLED=false` through initial wallet and token-payment validation. Test on Robinhood Chain testnet first. Before switching mainnet access on, apply the token-access migration, enable Ethereum Web3 Auth in Supabase, configure the production Reown origin, set the exact minted token and treasury addresses, set the operator-maintained token quantity that approximates USD $6, and prove valid payment, underpayment rejection, replay rejection, expiration, and renewal. After enabling it, `/health` must report both `tokenAccessGate: true` and `tokenPaymentConfigured: true`; a `true/false` combination is a failed deployment and blocks promotion.

## Rollback

Keep the previous two immutable Lightsail image references. If the new deployment fails health checks, reconnect tests, asset loading, or persistence:

1. Stop promotion and capture the deployment state plus `/health` and `/metrics` output.
2. Create a new deployment using the last known-good image reference and the same runtime secret configuration.
3. Wait until Lightsail reports the rollback deployment `ACTIVE` and the previous deployment is no longer receiving traffic.
4. Verify `/health`, create/join/reconnect, and one mission snapshot from the public origin.
5. If a migration is implicated, leave the database forward-compatible; restore from backup only after a temporary-project restore drill. Do not manually delete production rows.
6. Open an incident issue with the failed image, known-good image, timestamps, trace IDs, and follow-up owner.

Lightsail deployment history is not a substitute for recording exact image references in the GitHub release or milestone notes.
