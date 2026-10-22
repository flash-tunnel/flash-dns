import { createCloudflareAdapter, decodeOwnership, encodeOwnership } from '@flash-dns/adapter-cloudflare'
import { describe, expect, it } from 'vitest'
import { adapterContract } from './helpers/adapter-contract'
import { cloudflareFixture, owned, owner } from './helpers/cloudflare'

adapterContract('Cloudflare', () => cloudflareFixture().adapter)

describe('cloudflare adapter contract', () => {
  it('round-trips exact owner identity and rejects invalid or ambiguous metadata', () => {
    const encoded = encodeOwnership({ application: 'app:中文', id: 'id/with:separators' })
    expect(decodeOwnership(encoded)).toEqual({ application: 'app:中文', id: 'id/with:separators' })
    expect(decodeOwnership(`${encoded}\n${encoded}`)).toBeUndefined()
    expect(decodeOwnership(`prefix ${encoded}`)).toBeUndefined()
    expect(decodeOwnership('flash-dns:v1:invalid')).toBeUndefined()
    expect(() => encodeOwnership({ application: 'x', id: 'x'.repeat(1000) })).toThrow()
  })
  it('returns complete pages, canonical names, automatic TTL and raw TXT content', async () => {
    const f = cloudflareFixture([owned({ type: 'TXT', content: '"Mixed TEXT"', ttl: 1 }), owned({ id: 'r2', name: 'Other.Example.com.' })])
    f.setPageSize(1)
    const records = await f.adapter.listRecords('zone-1')
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ ttl: 'auto', content: '"Mixed TEXT"', ownership: owner })
    expect(records[1]?.name).toBe('other.example.com')
    expect(JSON.stringify(records)).not.toContain('fixture-secret')
    expect(await f.adapter.getRecord('zone-1', 'absent')).toBeUndefined()
  })
  it('maps auth errors without retries or secret leakage', async () => {
    for (const [status, code] of [[401, 'AUTH_INVALID'], [403, 'PERMISSION_DENIED']] as const) {
      const f = cloudflareFixture()
      f.failures.push({ method: 'GET', status })
      await expect(f.adapter.resolveZone('example.com')).rejects.toMatchObject({ code, retriable: false })
      expect(f.calls).toHaveLength(1)
      expect(f.sleeps).toHaveLength(0)
    }
  })
  it('honors Retry-After, retries read-only 5xx and stops at its bound', async () => {
    const f = cloudflareFixture()
    f.failures.push({ method: 'GET', status: 429, retryAfter: '2' }, { method: 'GET', status: 503 })
    await f.adapter.resolveZone('example.com')
    expect(f.sleeps).toEqual([2000, 500])
    f.failures.push(...Array.from({ length: 3 }, () => ({ method: 'GET', status: 503 })))
    await expect(f.adapter.resolveZone('example.com')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retriable: true })
    const f2 = cloudflareFixture()
    f2.failures.push({ method: 'GET', status: 429, retryAfter: '60' })
    await expect(f2.adapter.resolveZone('example.com')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(f2.sleeps).toHaveLength(0)
  })
  it('never blindly retries a failed mutation', async () => {
    const f = cloudflareFixture()
    f.failures.push({ method: 'POST', status: 503 })
    await expect(f.adapter.createRecord('zone-1', { zone: 'example.com', name: 'app.example.com', type: 'A', content: '192.0.2.1', owner })).rejects.toMatchObject({ retriable: true })
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  })
  it('rejects wrong or inactive Zones', async () => {
    const f = cloudflareFixture()
    await expect(f.adapter.resolveZone('other.com')).rejects.toMatchObject({ code: 'ZONE_NOT_FOUND' })
    const adapter = createCloudflareAdapter({ apiToken: 'token', zoneId: 'z', fetcher: async () => Response.json({ success: true, result: { id: 'z', name: 'example.com', status: 'pending' } }) })
    await expect(adapter.resolveZone('example.com')).rejects.toMatchObject({ code: 'ZONE_NOT_ACTIVE' })
  })
  it('cancels during fetch and retry delay', async () => {
    const controller = new AbortController()
    const adapter = createCloudflareAdapter({
      apiToken: 'token',
      fetcher: async () => {
        controller.abort()
        throw new Error('cancelled')
      }
    })
    await expect(adapter.resolveZone('example.com', { signal: controller.signal })).rejects.toMatchObject({ code: 'OPERATION_ABORTED' })
    const retryController = new AbortController()
    const retryAdapter = createCloudflareAdapter({
      apiToken: 'token',
      fetcher: async () => new Response('', { status: 429 }),
      sleep: async () => {
        retryController.abort()
        throw new Error('cancelled')
      }
    })
    await expect(retryAdapter.resolveZone('example.com', { signal: retryController.signal })).rejects.toMatchObject({ code: 'OPERATION_ABORTED' })
  })
})
