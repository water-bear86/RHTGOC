import { describe, expect, it, vi } from 'vitest'
import {
  LIGHTSAIL_STATUS_QUERY,
  assertRedactionSafeStatus,
  buildStatusArgs,
  runStatus,
} from './aws-lightsail-status.mjs'

describe('redaction-safe Lightsail status', () => {
  it('selects only non-secret service and deployment fields', () => {
    const args = buildStatusArgs('test-service', 'test-region')
    expect(args).toContain(LIGHTSAIL_STATUS_QUERY)
    expect(args.join(' ')).not.toContain('environment')
    expect(args).toEqual(expect.arrayContaining(['--service-name', 'test-service', '--region', 'test-region']))
  })

  it('rejects environment maps or known secret names defensively', () => {
    expect(() => assertRedactionSafeStatus({ environment: { SAFE: 'still forbidden' } })).toThrow(
      /forbidden field: environment/,
    )
    expect(() => assertRedactionSafeStatus({ value: 'OPS_ADMIN_SECRET' })).toThrow(
      /forbidden field: OPS_ADMIN_SECRET/,
    )
  })

  it('invokes AWS with the field-limited query', () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        serviceState: 'RUNNING',
        currentDeployment: { version: 7, state: 'ACTIVE', image: ':app.7' },
      }),
    }))
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    runStatus({ serviceName: 'test-service', region: 'test-region', spawn })
    write.mockRestore()

    expect(spawn).toHaveBeenCalledOnce()
    const [, args] = spawn.mock.calls[0]
    expect(args).toContain(LIGHTSAIL_STATUS_QUERY)
    expect(args.join(' ')).not.toContain('environment')
  })
})
