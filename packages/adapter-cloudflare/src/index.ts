import type { DesiredRecord, DnsAdapter, DnsRecord, OperationContext, Ownership, Zone } from '@flash-dns/types'
import { Buffer } from 'node:buffer'
import { setTimeout as delay } from 'node:timers/promises'
import { checkAborted, DnsError } from '@flash-dns/types'

export interface CloudflareOptions { proxied?: boolean }
export interface CloudflareAdapterOptions {
  apiToken: string
  zoneId?: string
  fetcher?: typeof fetch
  timeoutMs?: number
  maxRetries?: number
  maxRetryDelayMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

interface ApiRecord {
  id: string
  name: string
  type: string
  content: string
  ttl: number
  proxied?: boolean
  comment?: string
}
interface Envelope<T> {
  success: boolean
  result: T
  errors?: { code: number }[]
  result_info?: { page?: number, total_pages?: number }
}
interface ApiZone { id: string, name: string, status: string }
const marker = 'flash-dns:v1:'

export function encodeOwnership(owner: Ownership): string {
  const value = marker + Buffer.from(JSON.stringify([owner.application, owner.id]), 'utf8').toString('base64url')
  if (!owner.application || !owner.id || value.length > 500)
    throw new DnsError('CONFIG_INVALID', 'Owner must fit in a 500-character Cloudflare comment')
  return value
}

export function decodeOwnership(comment?: string): Ownership | undefined {
  const matches = comment?.split('\n').filter(line => line.startsWith(marker)) ?? []
  if (matches.length !== 1)
    return undefined
  try {
    const encoded = matches[0]!.slice(marker.length)
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string' && item.length > 0)) {
      const owner = { application: value[0] as string, id: value[1] as string }
      if (encodeOwnership(owner) === matches[0])
        return owner
    }
  }
  catch { /* Unrecognized metadata remains unmanaged. */ }
}

const normalizeName = (value: string): string => value.toLowerCase().replace(/\.$/, '')

export function createCloudflareAdapter(options: CloudflareAdapterOptions): DnsAdapter<CloudflareOptions> {
  if (!options.apiToken?.trim())
    throw new DnsError('AUTH_INVALID', 'CLOUDFLARE_API_TOKEN is required')
  const fetcher = options.fetcher ?? fetch
  const retries = options.maxRetries ?? 2
  const timeout = options.timeoutMs ?? 15000
  const maxDelay = options.maxRetryDelayMs ?? 10000
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))
  if (!Number.isInteger(retries) || retries < 0 || retries > 10 || !Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(maxDelay) || maxDelay < 0)
    throw new DnsError('CONFIG_INVALID', 'Invalid Cloudflare retry or timeout options')

  async function request<T>(path: string, method: string, body?: unknown, context?: OperationContext, missing?: 'record' | 'zone'): Promise<Envelope<T> | undefined> {
    for (let attempt = 0; ; attempt++) {
      checkAborted(context)
      let failure: DnsError
      let retryAfter: number | undefined
      try {
        const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(context?.signal ? [context.signal] : [])])
        const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
          method,
          signal,
          headers: { 'Authorization': `Bearer ${options.apiToken}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
        const retryHeader = response.headers.get('retry-after')
        if (retryHeader) {
          const seconds = Number(retryHeader)
          retryAfter = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryHeader) - Date.now())
          if (!Number.isFinite(retryAfter))
            retryAfter = undefined
        }
        const data = await response.json().catch(() => undefined) as Envelope<T> | undefined
        const codes = data?.errors?.map(error => error.code) ?? []
        if (missing && (response.status === 404 || (missing === 'record' && codes.includes(81044))))
          return undefined
        if (response.ok && data?.success === true && data.result != null)
          return data
        const code = response.status === 401 || codes.includes(10000)
          ? 'AUTH_INVALID'
          : response.status === 403
            ? 'PERMISSION_DENIED'
            : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR'
        failure = new DnsError(code, `Cloudflare ${method} request failed (HTTP ${response.status})`, {
          retriable: response.status === 429 || response.status >= 500,
          details: { status: response.status, codes, ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }) }
        })
      }
      catch {
        checkAborted(context)
        // Do not expose fetch errors: custom fetchers can include headers in their messages.
        failure = new DnsError('REQUEST_TIMEOUT', 'Cloudflare request timed out or could not reach the API', { retriable: true })
      }
      // Writes can have committed before their response failed. The core performs recovery reads.
      if (method !== 'GET' || !failure.retriable || attempt >= retries)
        throw failure
      const waitMs = retryAfter ?? Math.min(250 * 2 ** attempt, maxDelay)
      if (waitMs > maxDelay)
        throw failure
      try {
        await sleep(waitMs, context?.signal)
      }
      catch {
        checkAborted(context)
        throw failure
      }
    }
  }

  async function pages<T>(path: string, context?: OperationContext): Promise<T[]> {
    const result: T[] = []
    for (let page = 1; ; page++) {
      const data = await request<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, 'GET', undefined, context)
      if (!Array.isArray(data?.result))
        throw new DnsError('PROVIDER_ERROR', 'Malformed Cloudflare list response')
      result.push(...data.result)
      const total = data.result_info?.total_pages
      if (total !== undefined && (!Number.isInteger(total) || total < 0 || total > 100000))
        throw new DnsError('PROVIDER_ERROR', 'Invalid Cloudflare pagination metadata')
      if (total !== undefined ? page >= total : data.result.length < 100)
        break
      if (page >= 100000)
        throw new DnsError('PROVIDER_ERROR', 'Cloudflare pagination did not terminate')
    }
    return result
  }

  function record(data: ApiRecord, zoneId: string): DnsRecord<CloudflareOptions> {
    if (!data?.id || !data.name || !data.type || typeof data.content !== 'string' || !Number.isInteger(data.ttl))
      throw new DnsError('PROVIDER_ERROR', 'Malformed Cloudflare record response')
    return {
      id: data.id,
      zoneId,
      name: normalizeName(data.name),
      type: data.type,
      content: data.type === 'CNAME' ? normalizeName(data.content) : data.content,
      ttl: data.ttl === 1 ? 'auto' : data.ttl,
      ownership: decodeOwnership(data.comment),
      providerOptions: data.proxied === undefined ? {} : { proxied: data.proxied }
    }
  }

  function normalizeDesired(input: DesiredRecord<CloudflareOptions>, existing?: DnsRecord<CloudflareOptions>): DesiredRecord<CloudflareOptions> {
    encodeOwnership(input.owner)
    const proxied = input.providerOptions?.proxied ?? existing?.providerOptions?.proxied
    if (proxied !== undefined && typeof proxied !== 'boolean')
      throw new DnsError('CONFIG_INVALID', 'proxied must be boolean')
    if (input.type === 'TXT' && input.providerOptions?.proxied !== undefined)
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'TXT records do not support proxied')
    if (proxied === true && input.ttl !== undefined && input.ttl !== 'auto')
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'Proxied Cloudflare records require automatic TTL')
    return { ...input, ttl: input.providerOptions?.proxied === true ? 'auto' : input.ttl }
  }

  const zonePath = (zoneId: string): string => `/zones/${encodeURIComponent(zoneId)}`
  const recordsPath = (zoneId: string): string => `${zonePath(zoneId)}/dns_records`

  return {
    id: 'cloudflare',
    apiVersion: 1,
    capabilities: {
      recordTypes: ['A', 'AAAA', 'CNAME', 'TXT'],
      update: true,
      wildcard: true,
      ttl: { auto: true, min: 60, max: 86400 },
      ownership: 'metadata',
      lookupByName: true,
      extensions: ['proxied']
    },
    normalizeDesired,
    async resolveZone(name, context): Promise<Zone> {
      const zones = options.zoneId
        ? [(await request<ApiZone>(zonePath(options.zoneId), 'GET', undefined, context, 'zone'))?.result].filter((v): v is ApiZone => !!v)
        : await pages<ApiZone>(`/zones?name=${encodeURIComponent(name)}`, context)
      const matches = zones.filter(zone => normalizeName(zone.name) === normalizeName(name))
      if (matches.length !== 1)
        throw new DnsError('ZONE_NOT_FOUND', 'Expected exactly one matching Cloudflare Zone')
      const zone = matches[0]!
      if (zone.status !== 'active')
        throw new DnsError('ZONE_NOT_ACTIVE', 'Cloudflare Zone is not active')
      return { id: zone.id, name: normalizeName(zone.name) }
    },
    async listRecords(zoneId, name, context) {
      const data = await pages<ApiRecord>(`${recordsPath(zoneId)}${name ? `?name=${encodeURIComponent(name)}` : ''}`, context)
      return data.map(item => record(item, zoneId))
    },
    async getRecord(zoneId, recordId, context) {
      const data = await request<ApiRecord>(`${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`, 'GET', undefined, context, 'record')
      return data ? record(data.result, zoneId) : undefined
    },
    async createRecord(zoneId, input, context) {
      input = normalizeDesired(input)
      const body = {
        name: input.name,
        type: input.type,
        content: input.content,
        ttl: input.ttl === undefined || input.ttl === 'auto' ? 1 : input.ttl,
        ...(input.providerOptions?.proxied === undefined ? {} : { proxied: input.providerOptions.proxied }),
        comment: encodeOwnership(input.owner)
      }
      const data = await request<ApiRecord>(recordsPath(zoneId), 'POST', body, context)
      return record(data!.result, zoneId)
    },
    async updateRecord(zoneId, recordId, input, context) {
      input = normalizeDesired(input)
      // PATCH preserves user comments, tags, settings and omitted TTL/proxy fields.
      const body = {
        content: input.content,
        ...(input.ttl === undefined ? {} : { ttl: input.ttl === 'auto' ? 1 : input.ttl }),
        ...(input.providerOptions?.proxied === undefined ? {} : { proxied: input.providerOptions.proxied })
      }
      const data = await request<ApiRecord>(`${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`, 'PATCH', body, context)
      return record(data!.result, zoneId)
    },
    async deleteRecord(zoneId, recordId, context) {
      await request(`${recordsPath(zoneId)}/${encodeURIComponent(recordId)}`, 'DELETE', undefined, context, 'record')
    }
  }
}
