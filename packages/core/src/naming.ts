import { isIP } from 'node:net'
import { DnsError } from '@flash-dns/types'

export function normalizeProjectName(input: string): string {
  return validateLabel(input.replace(/^@/, '').replaceAll('/', '-').toLowerCase())
}

export function validateLabel(label: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    throw new DnsError('NAME_INVALID', `Invalid DNS label: ${label}`)
  return label
}

export function normalizeHostname(input: string, wildcard = false): string {
  if (typeof input !== 'string')
    throw new DnsError('NAME_INVALID', 'Hostname must be a string')
  const name = input.toLowerCase().replace(/\.$/, '')
  const labels = (wildcard && name.startsWith('*.') ? name.slice(2) : name).split('.')
  if (!name || name.length > 253)
    throw new DnsError('NAME_INVALID', 'Hostname must contain 1–253 ASCII characters')
  labels.forEach(validateLabel)
  return name
}

export function assertInZone(hostname: string, zone: string): void {
  if (hostname !== zone && !hostname.endsWith(`.${zone}`))
    throw new DnsError('NAME_INVALID', `Hostname ${hostname} is outside Zone ${zone}`)
}

export function renderHostname(template: string, variables: Record<string, string | undefined>): string {
  const result = template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const value = variables[key]
    if (value === undefined || value === '')
      throw new DnsError('TEMPLATE_VARIABLE_MISSING', `Missing template variable: ${key}`)
    return validateLabel(value.toLowerCase())
  })
  return normalizeHostname(result, true)
}

export function normalizeContent(type: string, content: string): string {
  if (typeof content !== 'string' || content.length === 0)
    throw new DnsError('CONFIG_INVALID', 'record.content must be a non-empty string')
  if ((type === 'A' && isIP(content) !== 4) || (type === 'AAAA' && isIP(content) !== 6))
    throw new DnsError('CONFIG_INVALID', `Invalid ${type} address`)
  if (type === 'AAAA')
    return new URL(`http://[${content}]/`).hostname.slice(1, -1)
  return type === 'CNAME' ? normalizeHostname(content) : content
}
