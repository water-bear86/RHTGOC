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
