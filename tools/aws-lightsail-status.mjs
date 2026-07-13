import { spawnSync } from 'node:child_process'

export const LIGHTSAIL_STATUS_QUERY =
  'containerServices[0].{serviceState:state,currentDeployment:{version:currentDeployment.version,state:currentDeployment.state,createdAt:currentDeployment.createdAt,image:currentDeployment.containers.app.image}}'

export function buildStatusArgs(serviceName = 'sherwood-rebellion', region = 'ca-central-1') {
  return [
    'lightsail',
    'get-container-services',
    '--service-name',
    serviceName,
    '--region',
    region,
    '--query',
    LIGHTSAIL_STATUS_QUERY,
    '--output',
    'json',
  ]
}

export function assertRedactionSafeStatus(value) {
  const serialized = JSON.stringify(value)
  const forbiddenKeys = ['environment', 'SUPABASE_SECRET_KEY', 'OPS_ADMIN_SECRET']
  for (const key of forbiddenKeys) {
    if (serialized.includes(key)) {
      throw new Error(`Unsafe Lightsail status response contained forbidden field: ${key}`)
    }
  }
  return value
}

export function runStatus({
  serviceName = process.env.AWS_LIGHTSAIL_SERVICE ?? 'sherwood-rebellion',
  region = process.env.AWS_REGION ?? 'ca-central-1',
  spawn = spawnSync,
} = {}) {
  const result = spawn('aws', buildStatusArgs(serviceName, region), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) process.exitCode = result.status ?? 1
  if (!result.stdout) return null
  const status = assertRedactionSafeStatus(JSON.parse(result.stdout))
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
  return status
}

if (import.meta.url === `file://${process.argv[1]}`) runStatus()
