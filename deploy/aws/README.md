# AWS deployment

The production artifact is a single container that serves the Vite build and the Merry Band WebSocket endpoint from one origin. This avoids cross-origin configuration and keeps the alpha architecture understandable.

Recommended first deployment: one small ARM64 or x86 Lightsail/EC2 instance behind HTTPS. The room server is currently intentionally single-instance and in-memory; do not add autoscaling until room state is moved to a shared store.

Required build arguments:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Runtime port: `8080`. Health check: `/health`. WebSocket endpoint: `/rooms`.

Before provisioning, configure an AWS CLI profile and choose an AWS region. Provisioning is intentionally not automated without explicit account identity and cost confirmation.
