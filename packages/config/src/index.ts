import type { RecordType, Ttl } from '@flash-dns/types'

export interface DnsConfig {
  provider?: 'cloudflare'
  zone?: string
  hostname?: string
  project?: { name?: string, id?: string }
  naming?: { template?: string }
  variables?: Record<string, string>
  record?: { type?: RecordType, content?: string, ttl?: Ttl }
  providers?: { cloudflare?: { zoneId?: string, proxied?: boolean } }
}

export function defineConfig<T extends DnsConfig>(config: T): T {
  return config
}
