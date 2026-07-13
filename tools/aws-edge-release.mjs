import { spawnSync } from "node:child_process"

export const MAX_CANARY_WEIGHT = 0.15
export const DEFAULT_EDGE_STACK = "sherwood-rhtgoc-edge"
export const EDGE_REGION = "us-east-1"

export const EDGE_STACK_QUERY =
  "Stacks[0].{stackStatus:StackStatus,canaryEnabled:Parameters[?ParameterKey==`CanaryEnabled`]|[0].ParameterValue,canaryWeight:Parameters[?ParameterKey==`CanaryWeight`]|[0].ParameterValue,canonicalUrl:Outputs[?OutputKey==`CanonicalUrl`]|[0].OutputValue,primaryDistributionId:Outputs[?OutputKey==`PrimaryDistributionId`]|[0].OutputValue,stagingDistributionId:Outputs[?OutputKey==`StagingDistributionId`]|[0].OutputValue,continuousDeploymentPolicyId:Outputs[?OutputKey==`ContinuousDeploymentPolicyId`]|[0].OutputValue,primaryClientBucketName:Outputs[?OutputKey==`PrimaryClientBucketName`]|[0].OutputValue,stagingClientBucketName:Outputs[?OutputKey==`StagingClientBucketName`]|[0].OutputValue,wwwRedirectDistributionId:Outputs[?OutputKey==`WwwRedirectDistributionId`]|[0].OutputValue}"

export const POLICY_STATUS_QUERY =
  "ContinuousDeploymentPolicyConfig.{enabled:Enabled,type:Type,stagingDistributionDnsNames:StagingDistributionDnsNames,traffic:TrafficConfig.{type:Type,weight:SingleWeightConfig.Weight,idleTTL:SingleWeightConfig.SessionStickinessConfig.IdleTTL,maximumTTL:SingleWeightConfig.SessionStickinessConfig.MaximumTTL}}"

export const EDGE_PARAMETER_KEYS = Object.freeze([
  "DomainName",
  "HostedZoneId",
  "LightsailOriginDomain",
  "CanaryEnabled",
  "CanaryWeight",
  "SessionIdleTTL",
  "SessionMaximumTTL",
  "PriceClass",
])

const STACK_NAME_PATTERN = /^[A-Za-z][-A-Za-z0-9]*$/
const CONTINUOUS_DEPLOYMENT_POLICY_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const FORBIDDEN_OUTPUT = /environment|secret|password|credential|private.?key|access.?key|ops_admin_secret|supabase_secret_key/i

export function parseCanaryWeight(value) {
  const weight = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_CANARY_WEIGHT) {
    throw new Error(`Canary weight must be between 0 and ${MAX_CANARY_WEIGHT}`)
  }
  return weight
}

export function validateOperatorTarget(stackName, region) {
  if (!STACK_NAME_PATTERN.test(stackName)) throw new Error("Invalid CloudFormation stack name")
  if (region !== EDGE_REGION) throw new Error(`The edge stack must be operated in ${EDGE_REGION}`)
}

export function buildStackStatusArgs(stackName = DEFAULT_EDGE_STACK, region = EDGE_REGION) {
  validateOperatorTarget(stackName, region)
  return [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    EDGE_STACK_QUERY,
    "--output",
    "json",
    "--no-cli-pager",
  ]
}

export function buildPolicyStatusArgs(policyId, region = EDGE_REGION) {
  if (!CONTINUOUS_DEPLOYMENT_POLICY_ID_PATTERN.test(policyId)) {
    throw new Error("Invalid continuous deployment policy id")
  }
  if (region !== EDGE_REGION) throw new Error(`The edge policy must be operated in ${EDGE_REGION}`)
  return [
    "cloudfront",
    "get-continuous-deployment-policy-config",
    "--id",
    policyId,
    "--region",
    region,
    "--query",
    POLICY_STATUS_QUERY,
    "--output",
    "json",
    "--no-cli-pager",
  ]
}

export function buildUpdateStackArgs(overrides, stackName = DEFAULT_EDGE_STACK, region = EDGE_REGION) {
  validateOperatorTarget(stackName, region)
  for (const key of Object.keys(overrides)) {
    if (!EDGE_PARAMETER_KEYS.includes(key)) throw new Error(`Refusing unknown edge parameter: ${key}`)
  }
  const parameters = EDGE_PARAMETER_KEYS.map((key) => {
    if (!(key in overrides)) return `ParameterKey=${key},UsePreviousValue=true`
    const value = String(overrides[key])
    if (value.includes(",") || value.includes("\n") || value.includes("\r")) {
      throw new Error(`Unsafe edge parameter value for ${key}`)
    }
    return `ParameterKey=${key},ParameterValue=${value}`
  })
  return [
    "cloudformation",
    "update-stack",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--use-previous-template",
    "--parameters",
    ...parameters,
    "--query",
    "StackId",
    "--output",
    "json",
    "--no-cli-pager",
  ]
}

export function assertSafeEdgeStatus(value) {
  const serialized = JSON.stringify(value)
  if (FORBIDDEN_OUTPUT.test(serialized)) {
    throw new Error("Unsafe AWS edge response contained a forbidden field")
  }
  return value
}

function invokeAws(spawn, args) {
  const result = spawn("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(`AWS edge command failed with exit code ${result.status ?? 1}; output was withheld`)
  }
  return result.stdout ? JSON.parse(result.stdout) : null
}

export function runStatus({ stackName, region, spawn = spawnSync, write = process.stdout.write.bind(process.stdout) }) {
  const stack = assertSafeEdgeStatus(invokeAws(spawn, buildStackStatusArgs(stackName, region)))
  if (!stack?.continuousDeploymentPolicyId) throw new Error("Edge stack did not expose a continuous deployment policy id")
  const policy = assertSafeEdgeStatus(
    invokeAws(spawn, buildPolicyStatusArgs(stack.continuousDeploymentPolicyId, region)),
  )
  const status = assertSafeEdgeStatus({ stack, policy })
  write(`${JSON.stringify(status, null, 2)}\n`)
  return status
}

export function runUpdate({
  action,
  overrides,
  stackName,
  region,
  spawn = spawnSync,
  write = process.stdout.write.bind(process.stdout),
}) {
  const stackId = assertSafeEdgeStatus(invokeAws(spawn, buildUpdateStackArgs(overrides, stackName, region)))
  const accepted = assertSafeEdgeStatus({ accepted: true, action, stackId, requested: overrides })
  write(`${JSON.stringify(accepted, null, 2)}\n`)
  return accepted
}

export function runRelease({
  argv = process.argv.slice(2),
  env = process.env,
  spawn = spawnSync,
  write = process.stdout.write.bind(process.stdout),
} = {}) {
  const stackName = env.AWS_EDGE_STACK || DEFAULT_EDGE_STACK
  const region = env.AWS_EDGE_REGION || EDGE_REGION
  const action = argv[0] || "status"
  if (action === "status") return runStatus({ stackName, region, spawn, write })
  if (action === "enable") {
    const weight = parseCanaryWeight(argv[1])
    return runUpdate({
      action,
      overrides: { CanaryEnabled: "true", CanaryWeight: weight },
      stackName,
      region,
      spawn,
      write,
    })
  }
  if (action === "set-weight") {
    const weight = parseCanaryWeight(argv[1])
    return runUpdate({ action, overrides: { CanaryWeight: weight }, stackName, region, spawn, write })
  }
  if (action === "disable") {
    return runUpdate({ action, overrides: { CanaryEnabled: "false" }, stackName, region, spawn, write })
  }
  throw new Error("Usage: node tools/aws-edge-release.mjs [status|enable WEIGHT|set-weight WEIGHT|disable]")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runRelease()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "AWS edge release command failed"}\n`)
    process.exitCode = 1
  }
}
