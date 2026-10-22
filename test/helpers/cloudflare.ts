import type { Ownership } from '@flash-dns/types'
import { createCloudflareAdapter, encodeOwnership } from '@flash-dns/adapter-cloudflare'

export interface TestRecord {
  id: string
  name: string
  type: string
  content: string
  ttl: number
  proxied?: boolean
  comment?: string
  tags?: string[]
}

export function cloudflareFixture(initial: TestRecord[] = []) {
  const records = new Map(initial.map(record => [record.id, structuredClone(record)]))
  const calls: { method: string, path: string, body?: Record<string, unknown> }[] = []
  const failures: { method: string, status?: number, retryAfter?: string, afterCommit?: boolean }[] = []
  let pageSize = 100
  let counter = 0
  let beforeList: (() => void) | undefined
  const response = (result: unknown, info?: unknown) => Response.json({ success: true, result, result_info: info })
  const fetcher: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url))
    const method = init?.method ?? 'GET'
    const path = parsed.pathname
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    calls.push({ method, path: parsed.pathname + parsed.search, body })
    const fail = failures[0]?.method === method ? failures.shift() : undefined
    if (fail && !fail.afterCommit) {
      if (!fail.status)
        throw new Error('network failure Bearer fixture-secret')
      return Response.json({ success: false, errors: [{ code: 123, message: 'fixture-secret' }] }, {
        status: fail.status,
        headers: fail.retryAfter ? { 'retry-after': fail.retryAfter } : {}
      })
    }
    if (path === '/client/v4/zones')
      return response([{ id: 'zone-1', name: 'example.com', status: 'active' }], { total_pages: 1 })
    if (path === '/client/v4/zones/zone-1')
      return response({ id: 'zone-1', name: 'example.com', status: 'active' })
    const id = path.split('/dns_records/')[1]
    if (id) {
      const current = records.get(id)
      if (!current)
        return Response.json({ success: false, errors: [{ code: 81044 }] }, { status: 404 })
      if (method === 'DELETE') {
        records.delete(id)
        return response({ id })
      }
      if (method === 'PATCH') {
        const updated = { ...current, ...body } as TestRecord
        records.set(id, updated)
        if (fail?.afterCommit)
          throw new Error('response lost')
        return response(updated)
      }
      return response(current)
    }
    if (method === 'POST') {
      const created = { id: `created-${++counter}`, proxied: false, ...body } as TestRecord
      records.set(created.id, created)
      if (fail?.afterCommit)
        throw new Error('response lost')
      return response(created)
    }
    beforeList?.()
    const all = [...records.values()].filter(record => !parsed.searchParams.has('name') || record.name.toLowerCase().replace(/\.$/, '') === parsed.searchParams.get('name'))
    const page = Number(parsed.searchParams.get('page') ?? 1)
    return response(all.slice((page - 1) * pageSize, page * pageSize), { total_pages: Math.max(1, Math.ceil(all.length / pageSize)) })
  }
  const sleeps: number[] = []
  const adapter = createCloudflareAdapter({
    apiToken: 'fixture-secret',
    zoneId: 'zone-1',
    fetcher,
    sleep: async (ms) => { sleeps.push(ms) }
  })
  return {
    adapter,
    records,
    calls,
    failures,
    fetcher,
    sleeps,
    setPageSize: (size: number) => { pageSize = size },
    onList: (handler: () => void) => { beforeList = handler }
  }
}

export const owner: Ownership = { application: 'test-app', id: 'project-1' }
export function owned(overrides: Partial<TestRecord> = {}): TestRecord {
  return { id: 'record-1', name: 'app.example.com', type: 'A', content: '192.0.2.1', ttl: 300, proxied: false, comment: encodeOwnership(owner), ...overrides }
}
