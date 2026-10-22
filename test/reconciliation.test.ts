import type { DesiredRecord } from '@flash-dns/types'
import { createDnsManager, normalizeProjectName } from '@flash-dns/core'
import { describe, expect, it } from 'vitest'
import { cloudflareFixture, owned, owner } from './helpers/cloudflare'

const desired: DesiredRecord<{ proxied?: boolean }> = {
  zone: 'example.com',
  name: 'app.example.com',
  type: 'A',
  content: '192.0.2.1',
  owner
}

describe('reconciliation and ownership', () => {
  it('plans without writing, creates once, and keeps the same ID on a second ensure', async () => {
    const f = cloudflareFixture()
    const manager = createDnsManager({ adapter: f.adapter })
    expect((await manager.plan(desired)).operation).toBe('create')
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
    const first = await manager.ensure(desired)
    const second = await manager.ensure(desired)
    expect(first.action).toBe('created')
    expect(second.action).toBe('unchanged')
    expect(first.ref.recordId).toBe(second.ref.recordId)
    expect(f.calls.filter(call => call.method === 'POST')).toHaveLength(1)
  })
  it('updates by ID and preserves TTL, proxy state, user notes and tags', async () => {
    const initial = owned({ proxied: true, ttl: 1, tags: ['user:note'] })
    initial.comment = `user note\n${initial.comment}`
    const f = cloudflareFixture([initial])
    const result = await createDnsManager({ adapter: f.adapter }).ensure({ ...desired, content: '192.0.2.2' })
    expect(result.action).toBe('updated')
    expect(result.record.id).toBe(initial.id)
    expect(f.records.get(initial.id)).toEqual({ ...initial, content: '192.0.2.2' })
    expect(f.calls.find(call => call.method === 'PATCH')?.body).toEqual({ content: '192.0.2.2' })
    expect(f.calls.some(call => call.method === 'DELETE')).toBe(false)
  })
  it.each([
    [undefined, 'RECORD_CONFLICT'],
    ['flash-tunnel:old-session', 'RECORD_CONFLICT'],
    [owned({}).comment!.replace('flash-dns:v1:', 'flash-dns:v2:'), 'RECORD_CONFLICT']
  ])('does not adopt unmanaged metadata %s', async (comment, code) => {
    const f = cloudflareFixture([owned({ comment })])
    await expect(createDnsManager({ adapter: f.adapter }).ensure(desired)).rejects.toMatchObject({ code })
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('detects the scoped/unscoped collision using independent owner identity', async () => {
    expect(normalizeProjectName('@org/name')).toBe(normalizeProjectName('org-name'))
    const f = cloudflareFixture([owned({ name: 'org-name.example.com' })])
    const result = await createDnsManager({ adapter: f.adapter }).plan({ ...desired, name: 'org-name.example.com', owner: { ...owner, id: 'other-project' } })
    expect(result.conflict?.code).toBe('OWNERSHIP_MISMATCH')
  })
  it('reads all pages and refuses ambiguous owned records unless ID is explicit', async () => {
    const f = cloudflareFixture([owned(), owned({ id: 'record-2', content: '192.0.2.9' })])
    f.setPageSize(1)
    const manager = createDnsManager({ adapter: f.adapter })
    expect((await manager.plan(desired)).conflict?.code).toBe('AMBIGUOUS_RECORD')
    expect((await manager.ensure({ ...desired, recordId: 'record-1' })).action).toBe('unchanged')
    expect(f.records.get('record-2')?.content).toBe('192.0.2.9')
  })
  it('preserves unrelated multi-value records and rejects CNAME/type coexistence', async () => {
    const f = cloudflareFixture([owned(), owned({ id: 'external', comment: undefined, content: '192.0.2.9' })])
    await createDnsManager({ adapter: f.adapter }).ensure({ ...desired, content: '192.0.2.3' })
    expect(f.records.get('external')?.content).toBe('192.0.2.9')
    const result = await createDnsManager({ adapter: f.adapter }).plan({ ...desired, type: 'CNAME', content: 'target.example.com' })
    expect(result.conflict?.code).toBe('RECORD_CONFLICT')
  })
  it('deletes only its exact ID, is idempotent, and preserves a replacement ID', async () => {
    const f = cloudflareFixture([owned()])
    const manager = createDnsManager({ adapter: f.adapter })
    const { ref } = await manager.ensure(desired)
    expect((await manager.remove(JSON.parse(JSON.stringify(ref)))).action).toBe('removed')
    f.records.set('replacement', owned({ id: 'replacement' }))
    expect((await manager.remove(ref)).action).toBe('already-absent')
    expect(f.records.has('replacement')).toBe(true)
  })
  it('refuses deletion when ownership or snapshot changes', async () => {
    const f = cloudflareFixture([owned()])
    const manager = createDnsManager({ adapter: f.adapter })
    const { ref } = await manager.ensure(desired)
    f.records.get('record-1')!.content = '192.0.2.99'
    await expect(manager.remove(ref)).rejects.toMatchObject({ code: 'PLAN_STALE' })
    f.records.get('record-1')!.comment = undefined
    await expect(manager.remove(ref)).rejects.toMatchObject({ code: 'OWNERSHIP_MISMATCH' })
  })
  it('recovers a create or update that committed before losing its response', async () => {
    for (const method of ['POST', 'PATCH']) {
      const f = cloudflareFixture(method === 'PATCH' ? [owned({ content: '192.0.2.9' })] : [])
      f.failures.push({ method, afterCommit: true })
      const result = await createDnsManager({ adapter: f.adapter }).ensure(desired)
      expect(result.record.content).toBe(desired.content)
      expect(f.calls.filter(call => call.method === method)).toHaveLength(1)
      expect(f.records.size).toBe(1)
    }
  })
  it('detects state changes between planning and execution', async () => {
    const f = cloudflareFixture([owned()])
    let lists = 0
    f.onList(() => {
      if (++lists === 2)
        f.records.get('record-1')!.content = '192.0.2.99'
    })
    await expect(createDnsManager({ adapter: f.adapter }).ensure(desired)).rejects.toMatchObject({ code: 'PLAN_STALE' })
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('serializes concurrent ensures within one manager', async () => {
    const f = cloudflareFixture()
    const manager = createDnsManager({ adapter: f.adapter })
    const results = await Promise.all([manager.ensure(desired), manager.ensure(desired)])
    expect(results.map(result => result.action)).toEqual(['created', 'unchanged'])
    expect(f.records.size).toBe(1)
  })
  it('checks cancellation before requests and rejects unsupported capabilities', async () => {
    const f = cloudflareFixture()
    const manager = createDnsManager({ adapter: f.adapter })
    await expect(manager.ensure(desired, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'OPERATION_ABORTED' })
    await expect(manager.plan({ ...desired, providerOptions: { unsupported: true } } as unknown as typeof desired)).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    await expect(manager.plan({ ...desired, type: 'TXT', providerOptions: { proxied: true } })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    expect(f.calls).toHaveLength(0)
  })
  it('rejects explicit manual TTL when preserving an already proxied record', async () => {
    const f = cloudflareFixture([owned({ proxied: true, ttl: 1 })])
    await expect(createDnsManager({ adapter: f.adapter }).ensure({ ...desired, ttl: 300 })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('does not delete or rewrite the original record after a failed update', async () => {
    const f = cloudflareFixture([owned()])
    f.failures.push({ method: 'PATCH', status: 403 })
    await expect(createDnsManager({ adapter: f.adapter }).ensure({ ...desired, content: '192.0.2.2' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(f.records.get('record-1')?.content).toBe('192.0.2.1')
    expect(f.calls.some(call => call.method === 'DELETE')).toBe(false)
  })
})
