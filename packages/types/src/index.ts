export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT'
export type Ttl = number | 'auto'
export interface Ownership { application: string, id: string }
export interface OperationContext {
  signal?: AbortSignal
  requestId?: string
  logger?: (event: { event: string, requestId?: string, recordId?: string }) => void
}
export interface DesiredRecord<P = Record<string, unknown>> {
  zone: string
  name: string
  type: RecordType
  content: string
  owner: Ownership
  ttl?: Ttl
  recordId?: string
  providerOptions?: P
}
export interface DnsRecord<P = Record<string, unknown>> {
  id: string
  zoneId: string
  name: string
  type: string
  content: string
  ttl: Ttl
  ownership?: Ownership
  providerOptions?: P
  providerData?: Record<string, unknown>
}
export interface Zone { id: string, name: string }
export interface RecordRef {
  provider: string
  zoneId: string
  recordId: string
  owner: Ownership
  snapshot?: { name: string, type: string, content: string }
}
export interface DnsCapabilities {
  recordTypes: readonly RecordType[]
  update: boolean
  wildcard: boolean
  ttl: { auto: boolean, min: number, max: number }
  ownership: 'metadata' | 'unsupported'
  lookupByName: boolean
  extensions: readonly string[]
}
export interface DnsAdapter<P = Record<string, unknown>> {
  id: string
  apiVersion: 1
  capabilities: DnsCapabilities
  normalizeDesired?: (input: DesiredRecord<P>, existing?: DnsRecord<P>) => DesiredRecord<P>
  resolveZone: (name: string, context?: OperationContext) => Promise<Zone>
  listRecords: (zoneId: string, name?: string, context?: OperationContext) => Promise<DnsRecord<P>[]>
  getRecord: (zoneId: string, recordId: string, context?: OperationContext) => Promise<DnsRecord<P> | undefined>
  createRecord: (zoneId: string, input: DesiredRecord<P>, context?: OperationContext) => Promise<DnsRecord<P>>
  updateRecord: (zoneId: string, recordId: string, input: DesiredRecord<P>, context?: OperationContext) => Promise<DnsRecord<P>>
  deleteRecord: (zoneId: string, recordId: string, context?: OperationContext) => Promise<void>
}
export type ErrorCode
  = | 'CONFIG_INVALID' | 'NAME_INVALID' | 'TEMPLATE_VARIABLE_MISSING'
    | 'CAPABILITY_UNSUPPORTED' | 'ADAPTER_INCOMPATIBLE'
    | 'AUTH_INVALID' | 'PERMISSION_DENIED' | 'ZONE_NOT_FOUND' | 'ZONE_NOT_ACTIVE'
    | 'RECORD_CONFLICT' | 'OWNERSHIP_MISMATCH' | 'AMBIGUOUS_RECORD'
    | 'RECORD_NOT_FOUND' | 'PLAN_STALE' | 'PROVIDER_ERROR'
    | 'RATE_LIMITED' | 'REQUEST_TIMEOUT' | 'OPERATION_ABORTED'

export class DnsError extends Error {
  readonly code: ErrorCode
  readonly hint?: string
  readonly retriable: boolean
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, options: {
    hint?: string
    retriable?: boolean
    details?: Record<string, unknown>
    cause?: unknown
  } = {}) {
    super(message, { cause: options.cause })
    this.name = 'DnsError'
    this.code = code
    this.hint = options.hint
    this.retriable = options.retriable ?? false
    this.details = options.details
  }
}

export function checkAborted(context?: OperationContext): void {
  if (context?.signal?.aborted)
    throw new DnsError('OPERATION_ABORTED', 'Operation cancelled')
}

export function sameOwner(a: Ownership | undefined, b: Ownership): boolean {
  return a?.application === b.application && a.id === b.id
}
