import type { DesiredRecord, DnsAdapter, DnsRecord, OperationContext, RecordRef, Zone } from '@flash-dns/types'
import { checkAborted, DnsError, sameOwner } from '@flash-dns/types'
import { assertInZone, normalizeContent, normalizeHostname } from './naming'

export interface DnsPlan<P = Record<string, unknown>> {
  operation: 'create' | 'update' | 'noop' | 'conflict'
  zone: Zone
  desired: DesiredRecord<P>
  existing?: DnsRecord<P>
  conflict?: { code: 'RECORD_CONFLICT' | 'OWNERSHIP_MISMATCH' | 'AMBIGUOUS_RECORD', message: string }
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    return item
  })
}

export interface EnsureResult<P = Record<string, unknown>> {
  action: 'created' | 'updated' | 'unchanged'
  record: DnsRecord<P>
  ref: RecordRef
}
export interface RemoveResult { action: 'removed' | 'already-absent' }
export interface DnsManager<P = Record<string, unknown>> {
  plan: (input: DesiredRecord<P>, context?: OperationContext) => Promise<DnsPlan<P>>
  ensure: (input: DesiredRecord<P>, context?: OperationContext) => Promise<EnsureResult<P>>
  remove: (target: RecordRef, context?: OperationContext) => Promise<RemoveResult>
}

export function createDnsManager<P extends object>(options: { adapter: DnsAdapter<P> }): DnsManager<P> {
  const { adapter } = options
  const methods = ['resolveZone', 'listRecords', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord'] as const
  const caps = adapter?.capabilities
  if (!adapter || adapter.apiVersion !== 1 || methods.some(method => typeof adapter[method] !== 'function') || !caps
    || !Array.isArray(caps.recordTypes) || !Array.isArray(caps.extensions) || !caps.ttl
    || typeof caps.update !== 'boolean' || typeof caps.wildcard !== 'boolean' || typeof caps.lookupByName !== 'boolean') {
    throw new DnsError('ADAPTER_INCOMPATIBLE', 'Adapter must implement the v1 contract')
  }
  const locks = new Map<string, Promise<unknown>>()

  async function locked<T>(key: string, execute: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(execute)
    locks.set(key, next)
    try {
      return await next
    }
    finally {
      if (locks.get(key) === next)
        locks.delete(key)
    }
  }

  function normalize(input: DesiredRecord<P>): DesiredRecord<P> {
    const name = normalizeHostname(input.name, true)
    const zone = normalizeHostname(input.zone)
    assertInZone(name, zone)
    const caps = adapter.capabilities
    if (!caps.recordTypes.includes(input.type) || caps.ownership !== 'metadata' || !caps.lookupByName
      || (name.startsWith('*.') && !caps.wildcard)) {
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'Adapter does not support the requested record or ownership')
    }
    if (!input.owner?.application?.trim() || !input.owner.id?.trim())
      throw new DnsError('CONFIG_INVALID', 'A stable owner.application and owner.id are required')
    if (input.ttl !== undefined && (input.ttl === 'auto'
      ? !caps.ttl.auto
      : !Number.isInteger(input.ttl) || input.ttl < caps.ttl.min || input.ttl > caps.ttl.max)) {
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'Unsupported TTL')
    }
    if (Object.keys(input.providerOptions ?? {}).some(key => !caps.extensions.includes(key)))
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'Unsupported provider option')
    const desired = { ...input, name, zone, content: normalizeContent(input.type, input.content) }
    return adapter.normalizeDesired?.(desired) ?? desired
  }

  function matches(record: DnsRecord<P>, desired: DesiredRecord<P>): boolean {
    return normalizeHostname(record.name, true) === desired.name && record.type === desired.type
      && normalizeContent(record.type, record.content) === desired.content
      && sameOwner(record.ownership, desired.owner)
      && (desired.ttl === undefined || record.ttl === desired.ttl)
      && Object.entries(desired.providerOptions ?? {}).every(([key, value]) => (record.providerOptions as Record<string, unknown> | undefined)?.[key] === value)
  }

  async function plan(input: DesiredRecord<P>, context?: OperationContext): Promise<DnsPlan<P>> {
    checkAborted(context)
    let desired = normalize(input)
    const zone = await adapter.resolveZone(desired.zone, context)
    assertInZone(desired.name, normalizeHostname(zone.name))
    const records = (await adapter.listRecords(zone.id, desired.name, context))
      .filter(record => normalizeHostname(record.name, true) === desired.name)
    const base = { zone, desired }
    const conflict = (code: NonNullable<DnsPlan['conflict']>['code'], message: string): DnsPlan<P> => ({
      ...base,
      operation: 'conflict',
      conflict: { code, message }
    })
    // CNAME cannot coexist with another record type, including unmanaged types.
    if (records.some(record => record.type !== desired.type && (record.type === 'CNAME' || desired.type === 'CNAME')))
      return conflict('RECORD_CONFLICT', 'CNAME cannot coexist with another record type')
    const candidates = records.filter(record => record.type === desired.type)
    let existing: DnsRecord<P> | undefined
    if (desired.recordId) {
      existing = candidates.find(record => record.id === desired.recordId)
      if (!existing)
        throw new DnsError('RECORD_NOT_FOUND', 'Explicit record ID does not match the requested name and type')
    }
    else {
      const owned = candidates.filter(record => sameOwner(record.ownership, desired.owner))
      if (owned.length > 1)
        return conflict('AMBIGUOUS_RECORD', 'Multiple owned records match; specify recordId')
      existing = owned[0]
      if (!existing && candidates.length) {
        return candidates.some(record => record.ownership)
          ? conflict('OWNERSHIP_MISMATCH', 'Name is already used by a different owner')
          : conflict('RECORD_CONFLICT', 'Existing records have no matching owner; automatic adoption is disabled')
      }
    }
    if (existing && !sameOwner(existing.ownership, desired.owner))
      return conflict(existing.ownership ? 'OWNERSHIP_MISMATCH' : 'RECORD_CONFLICT', 'Selected record does not belong to this owner')
    desired = adapter.normalizeDesired?.(desired, existing) ?? desired
    if (existing && !matches(existing, desired) && !adapter.capabilities.update)
      throw new DnsError('CAPABILITY_UNSUPPORTED', 'Adapter does not support updates')
    checkAborted(context)
    return { ...base, desired, existing, operation: existing ? matches(existing, desired) ? 'noop' : 'update' : 'create' }
  }

  function ref(record: DnsRecord<P>, owner: DesiredRecord<P>['owner']): RecordRef {
    return {
      provider: adapter.id,
      zoneId: record.zoneId,
      recordId: record.id,
      owner,
      snapshot: { name: record.name, type: record.type, content: record.content }
    }
  }

  async function ensure(input: DesiredRecord<P>, context?: OperationContext): Promise<EnsureResult<P>> {
    const desired = normalize(input)
    return locked('write', async () => {
      const first = await plan(desired, context)
      if (first.conflict)
        throw new DnsError(first.conflict.code, first.conflict.message)
      const current = await plan(desired, context)
      if (fingerprint(first) !== fingerprint(current))
        throw new DnsError('PLAN_STALE', 'Records changed during planning; run ensure again')
      checkAborted(context)
      const effective = current.desired
      let actual = current.existing
      if (current.operation !== 'noop') {
        try {
          actual = current.operation === 'create'
            ? await adapter.createRecord(current.zone.id, effective, context)
            : await adapter.updateRecord(current.zone.id, current.existing!.id, effective, context)
        }
        catch (error) {
          // A failed response can follow a committed write. Reconcile before any retry.
          if (!(error instanceof DnsError) || !error.retriable || context?.signal?.aborted)
            throw error
          const recovered = await plan(desired, context)
          if (recovered.operation !== 'noop' || !recovered.existing)
            throw error
          actual = recovered.existing
        }
        actual = await adapter.getRecord(current.zone.id, actual!.id, context)
      }
      if (!actual || !matches(actual, effective))
        throw new DnsError('PLAN_STALE', 'Provider state does not match the requested record after the operation')
      const action = current.operation === 'create' ? 'created' : current.operation === 'update' ? 'updated' : 'unchanged'
      context?.logger?.({ event: `record:${action}`, requestId: context.requestId, recordId: actual.id })
      return { action, record: actual, ref: ref(actual, desired.owner) }
    })
  }

  async function remove(target: RecordRef, context?: OperationContext): Promise<RemoveResult> {
    if (target.provider !== adapter.id || !target.zoneId || !target.recordId || !target.owner?.application || !target.owner.id)
      throw new DnsError('CONFIG_INVALID', 'A complete record ref for this provider is required')
    return locked('write', async () => {
      checkAborted(context)
      const record = await adapter.getRecord(target.zoneId, target.recordId, context)
      if (!record)
        return { action: 'already-absent' as const }
      if (!sameOwner(record.ownership, target.owner))
        throw new DnsError('OWNERSHIP_MISMATCH', 'Record owner changed; deletion refused')
      if (target.snapshot && fingerprint(target.snapshot) !== fingerprint({ name: record.name, type: record.type, content: record.content }))
        throw new DnsError('PLAN_STALE', 'Record changed since selection; deletion refused')
      checkAborted(context)
      await adapter.deleteRecord(target.zoneId, target.recordId, context)
      if (await adapter.getRecord(target.zoneId, target.recordId, context))
        throw new DnsError('PLAN_STALE', 'Provider still returns the deleted record')
      context?.logger?.({ event: 'record:removed', requestId: context.requestId, recordId: target.recordId })
      return { action: 'removed' as const }
    })
  }

  return { plan, ensure, remove }
}
