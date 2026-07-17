# `rhtgoc.site` edge, DNS, and canary runbook

This runbook moves the browser client from the registrar parking page to a private S3/CloudFront edge while preserving the current single authoritative Lightsail room process.

The edge is not permission to increase the Lightsail service above one node. Rooms, matchmaking, and reconnect state are still process-local. Both the primary and staging clients send `/rooms` and every dynamic request to the same Lightsail hostname.

## Architecture and invariants

- Namecheap remains the registrar. Route 53 becomes the authoritative DNS service.
- `rhtgoc.site` serves the primary private S3 client through CloudFront.
- `www.rhtgoc.site` returns a path- and query-preserving `308` to the apex.
- A private staging S3 client receives at most 15% of apex traffic through CloudFront continuous deployment.
- Sticky canary sessions keep one viewer on one client release for a bounded period.
- `/rooms`, `/access*`, `/rotations*`, `/season*`, `/admin/*`, `/health*`, `/ready*`, `/metrics*`, `/analytics*`, and `/api/*` are never cached and go to the same Lightsail backend.
- The WebSocket origin request policy forwards viewer headers, cookies, and query strings except `Host`. CloudFront supplies the Lightsail origin host, so its TLS certificate remains valid.
- The S3 buckets block all public access. CloudFront uses signed origin access control requests.
- The Route 53 zone and both versioned S3 buckets are retained if a stack is deleted.

The two CloudFormation stacks are intentionally separate. Creating a certificate in the same operation as a brand-new, not-yet-delegated hosted zone creates an operator catch-22: certificate validation waits for DNS delegation, but the finished stack output is where most operators look for the new nameservers.

## Prerequisites

1. Use the intended AWS account and authenticate the AWS CLI.
2. Confirm that the Lightsail origin is healthy at its existing hostname.
3. Back up every DNS record currently used by the domain. Changing Namecheap nameservers does not copy MX, TXT, CAA, or other records.
4. Keep the Lightsail container scale at `1`.
5. Do not enable canary traffic until client/server build compatibility checks are live.

All edge resources are operated from `us-east-1`. CloudFront requires its ACM viewer certificate in that region.

## 1. Create the hosted zone

From the repository root:

```bash
aws cloudformation deploy \
  --template-file deploy/aws/rhtgoc-dns.yaml \
  --stack-name sherwood-rhtgoc-dns \
  --region us-east-1 \
  --parameter-overrides DomainName=rhtgoc.site \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
  --stack-name sherwood-rhtgoc-dns \
  --region us-east-1 \
  --query 'Stacks[0].{status:StackStatus,hostedZoneId:Outputs[?OutputKey==`HostedZoneId`]|[0].OutputValue,nameServers:Outputs[?OutputKey==`NameServers`]|[0].OutputValue}' \
  --output json \
  --no-cli-pager
```

The `nameServers` value contains four comma-separated Route 53 nameservers.

## 2. Delegate Namecheap to Route 53

In Namecheap:

1. Open **Domain List**.
2. Select **Manage** beside `rhtgoc.site`.
3. Under **Nameservers**, choose **Custom DNS**.
4. Paste the four Route 53 nameservers, one per field, without the commas.
5. Save the change.

Namecheap documents this flow at [How to change DNS for a domain](https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/). Their parking A record and `www` CNAME stop being authoritative after delegation. Restore any required mail or verification records in Route 53 before relying on them.

Verify delegation from more than one resolver. Continue only when the returned set matches the stack output:

```bash
dig +short NS rhtgoc.site
dig @1.1.1.1 +short NS rhtgoc.site
dig @8.8.8.8 +short NS rhtgoc.site
```

Registrar propagation can take time. Do not create a second hosted zone if the first resolver is merely stale.

## 3. Create the certificate and edge

Set the hosted zone ID returned by the DNS stack:

```bash
export RHTGOC_HOSTED_ZONE_ID=Z_REPLACE_ME

aws cloudformation deploy \
  --template-file deploy/aws/rhtgoc-edge.yaml \
  --stack-name sherwood-rhtgoc-edge \
  --region us-east-1 \
  --parameter-overrides \
    DomainName=rhtgoc.site \
    HostedZoneId="$RHTGOC_HOSTED_ZONE_ID" \
    LightsailOriginDomain=sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com \
    CanaryEnabled=false \
    CanaryWeight=0 \
  --no-fail-on-empty-changeset
```

This operation creates DNS-validated ACM coverage for the apex and `www`, two private versioned client buckets, primary and staging distributions, the weighted policy, the canonical redirect, and Route 53 `A`/`AAAA` aliases.

AWS documents the relevant constraints here:

- [CloudFront certificates must be in `us-east-1`](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)
- [CloudFront continuous deployment traffic and stickiness](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-continuous-deployment.html)
- [Continuous deployment quotas, including the 15% maximum](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/continuous-deployment-quotas-considerations.html)
- [Private S3 origins with origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)

Inspect only the field-limited status view:

```bash
node tools/aws-edge-release.mjs status
```

The tool refuses another region, canary weights above `0.15`, unknown stack parameters, and AWS responses containing secret-like fields. It never requests container environments, credentials, or application secrets.

## 4. Publish the first primary client

Build and capture the field-limited stack output:

```bash
npm run build
EDGE_STATUS="$(node tools/aws-edge-release.mjs status)"
PRIMARY_BUCKET="$(jq -r '.stack.primaryClientBucketName' <<<"$EDGE_STATUS")"
PRIMARY_DISTRIBUTION="$(jq -r '.stack.primaryDistributionId' <<<"$EDGE_STATUS")"
```

Upload the complete build, then explicitly mark the entry document non-cacheable:

```bash
aws s3 sync dist "s3://$PRIMARY_BUCKET" --only-show-errors
aws s3 cp dist/index.html "s3://$PRIMARY_BUCKET/index.html" \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'no-cache, no-store, must-revalidate' \
  --only-show-errors

aws cloudfront create-invalidation \
  --distribution-id "$PRIMARY_DISTRIBUTION" \
  --paths '/*' \
  --query 'Invalidation.{id:Id,status:Status,createdAt:CreateTime}' \
  --output json \
  --no-cli-pager
```

Do not add `--delete` to the sync. Existing players can still request lazy chunks
from the previous build while a release is moving through CloudFront. Retire old
hashed assets with a separate retention policy only after the supported session
window; bucket versioning makes release-time deletion unsuitable as storage cleanup.

The `/assets/*` cache key includes query strings. Stable-name GLBs must carry the client build/version query, while Vite's JS and CSS filenames remain content-hashed.

## 5. Configure application origins

Before calling the domain production-ready:

1. Redeploy the Lightsail container with `PUBLIC_ORIGIN=https://rhtgoc.site` while preserving every existing runtime secret.
2. Add `https://rhtgoc.site` to the Reown project allowlist.
3. Add `https://rhtgoc.site` to the Supabase Site URL and allowed redirect URLs.
4. Keep the direct Lightsail hostname available for operator health checks, but stop presenting it as the player URL.

Neither CloudFront nor Route 53 replaces those application allowlists.

## 6. Run a client canary

Build the candidate, upload it to the staging bucket, and invalidate only the staging distribution:

```bash
npm run build
EDGE_STATUS="$(node tools/aws-edge-release.mjs status)"
STAGING_BUCKET="$(jq -r '.stack.stagingClientBucketName' <<<"$EDGE_STATUS")"
STAGING_DISTRIBUTION="$(jq -r '.stack.stagingDistributionId' <<<"$EDGE_STATUS")"

aws s3 sync dist "s3://$STAGING_BUCKET" --only-show-errors
aws s3 cp dist/index.html "s3://$STAGING_BUCKET/index.html" \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'no-cache, no-store, must-revalidate' \
  --only-show-errors
aws cloudfront create-invalidation \
  --distribution-id "$STAGING_DISTRIBUTION" \
  --paths '/*' \
  --query 'Invalidation.{id:Id,status:Status,createdAt:CreateTime}' \
  --output json \
  --no-cli-pager
```

Start at 5%, not 15%:

```bash
node tools/aws-edge-release.mjs enable 0.05
aws cloudformation wait stack-update-complete \
  --stack-name sherwood-rhtgoc-edge \
  --region us-east-1
node tools/aws-edge-release.mjs status
```

CloudFront sets a sticky release cookie. It may route all requests to primary during peak CloudFront utilization, so analytics must record the actual release/build ID rather than infer assignment from the configured weight.

Change the weight without changing the enabled state:

```bash
node tools/aws-edge-release.mjs set-weight 0.10
```

Stop a canary immediately:

```bash
node tools/aws-edge-release.mjs disable
```

The update command only reports that CloudFormation accepted the change. `status` and the stack waiter establish completion.

## 7. Promote or roll back

Do not call CloudFront `update-distribution-with-staging-config` for this layout. The staging distribution intentionally points to a different S3 bucket, and that API would copy the staging origin into the primary configuration and create CloudFormation drift.

Promotion is deterministic:

1. Disable the canary and wait for the stack update.
2. Upload the exact verified candidate artifact to the primary bucket.
3. Invalidate the primary distribution.
4. Verify build ID, health, create/join, reconnect, wallet sign-in, and one full mission from the apex.

Rollback is the same operation with the previous immutable artifact. S3 versioning provides recovery material but is not a substitute for recording the exact release/build ID.

## 8. Production verification

```bash
dig +short A rhtgoc.site
dig +short AAAA rhtgoc.site
curl -fsSI https://rhtgoc.site/
curl -fsSI 'https://www.rhtgoc.site/check?release=1'
curl -fsS https://rhtgoc.site/health | jq '{ok,protocolVersion,rooms,missionId,missionVersion}'

ROOM_SERVER_URL=wss://rhtgoc.site/rooms npm run test:reconnect
ROOM_SERVER_URL=wss://rhtgoc.site/rooms ROOMS=4 DURATION_MS=5000 npm run test:load
```

Acceptance requires:

- Apex HTTPS succeeds with the ACM certificate.
- `www` returns `308` and preserves `/check?release=1`.
- `/health` is uncached and comes from Lightsail.
- WebSocket create/join/reconnect succeeds through CloudFront.
- The page and stable-name GLBs report the same client build; the room server reports its own build and accepts every client with the current protocol version.
- Wallet signing uses `rhtgoc.site` as the displayed origin.
- Canary analytics separate primary and staging by actual build ID.
- Lightsail remains at scale `1` until room ownership and state are externalized.
