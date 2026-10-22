import type { DnsConfig } from '@flash-dns/config'
import type { DesiredRecord } from '@flash-dns/types'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, parse, resolve } from 'node:path'
import process from 'node:process'
import { DnsError } from '@flash-dns/types'
import { createJiti } from 'jiti'
import { loadConfig } from 'unconfig'
import { assertInZone, normalizeHostname, normalizeProjectName, renderHostname } from './naming'

const require = createRequire(import.meta.url)
const filenames = ['ts', 'mts', 'js', 'mjs', 'json'].map(ext => `flash-dns.config.${ext}`)

export function findConfigFile(cwd: string): string | undefined {
  let dir = resolve(cwd)
  while (true) {
    for (const filename of filenames) {
      const candidate = join(dir, filename)
      if (existsSync(candidate))
        return candidate
    }
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir)
      return undefined
    dir = dirname(dir)
  }
}

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DnsError('CONFIG_INVALID', `${path} must be an object`)
}

export function validateConfig(config: unknown): asserts config is DnsConfig {
  object(config, 'config')
  const schema: Record<string, string | Record<string, unknown>> = {
    provider: 'string',
    zone: 'string',
    hostname: 'string',
    project: { name: 'string', id: 'string' },
    naming: { template: 'string' },
    variables: 'variables',
    record: { type: 'string', content: 'string', ttl: 'ttl' },
    providers: { cloudflare: { zoneId: 'string', proxied: 'boolean' } }
  }
  function visit(value: Record<string, unknown>, fields: Record<string, unknown>, path: string): void {
    for (const [key, item] of Object.entries(value)) {
      const spec = fields[key]
      const field = `${path}.${key}`
      if (!spec)
        throw new DnsError('CONFIG_INVALID', `Unknown field: ${field}`)
      if (item === undefined)
        continue
      if (typeof spec === 'object') {
        object(item, field)
        visit(item, spec as Record<string, unknown>, field)
      }
      else if (spec === 'variables') {
        object(item, field)
        if (Object.values(item).some(v => typeof v !== 'string'))
          throw new DnsError('CONFIG_INVALID', `${field} values must be strings`)
      }
      else if (spec === 'ttl'
        ? item !== 'auto' && (!Number.isInteger(item) || Number(item) <= 0)
        : spec === 'boolean' ? typeof item !== 'boolean' : typeof item !== 'string') {
        throw new DnsError('CONFIG_INVALID', `Invalid value for ${field}`)
      }
    }
  }
  visit(config, schema, 'config')
}

export async function loadDnsConfig(cwd: string, explicit?: string): Promise<{ config: DnsConfig, source?: string, configDir: string }> {
  const source = explicit ? resolve(cwd, explicit) : findConfigFile(cwd)
  if (!source)
    return { config: {}, configDir: resolve(cwd) }
  if (!existsSync(source))
    throw new DnsError('CONFIG_INVALID', `Config file not found: ${source}`)
  try {
    const file = parse(source)
    // Resolve the config-only module from this installation, including npx's temporary tree.
    const configModule = require.resolve('@flash-dns/config')
    const jiti = createJiti(import.meta.url, {
      fsCache: false,
      moduleCache: false,
      alias: {
        'flash-dns/config': configModule,
        'flash-dns': configModule,
        '@flash-dns/config': configModule
      }
    })
    const loaded = await loadConfig<DnsConfig>({
      cwd: file.dir,
      merge: false,
      sources: [{
        files: file.name,
        extensions: [file.ext.slice(1)],
        parser: file.ext === '.json' ? 'json' : filepath => jiti.import<DnsConfig>(filepath, { default: true })
      }]
    })
    validateConfig(loaded.config)
    return { config: loaded.config, source, configDir: file.dir }
  }
  catch (cause) {
    throw new DnsError('CONFIG_INVALID', `Invalid configuration: ${source}`, {
      hint: cause instanceof DnsError ? cause.message : 'Check the configuration syntax and imports',
      cause
    })
  }
}

export interface CliOverrides {
  provider?: string
  zone?: string
  hostname?: string
  project?: string
  projectId?: string
  template?: string
  type?: string
  content?: string
  ttl?: string | number
  zoneId?: string
  proxied?: boolean
  branch?: string
  session?: string
}

export interface ResolvedDnsConfig {
  provider: string
  zone: string
  hostname: string
  projectId?: string
  type?: string
  content?: string
  ttl?: number | 'auto'
  proxied?: boolean
  zoneId?: string
  sources: Record<string, string>
  configDir: string
}

export function resolveDnsConfig(input: { cwd: string, config: DnsConfig, configFile?: string, env?: Record<string, string | undefined>, cli?: CliOverrides }): ResolvedDnsConfig {
  validateConfig(input.config)
  const config = input.config
  const cli = input.cli ?? {}
  const env = input.env ?? process.env
  const sources: Record<string, string> = {}
  function pick<T>(path: string, cliValue: T | undefined, envValue: T | undefined, fileValue: T | undefined, fallback?: T): T | undefined {
    for (const [source, value] of [['cli', cliValue], ['env', envValue], ['config', fileValue], ['default', fallback]] as const) {
      if (value !== undefined) {
        sources[path] = source
        return value
      }
    }
  }
  const provider = pick('provider', cli.provider, env.FLASH_DNS_PROVIDER, config.provider, 'cloudflare')
  if (provider !== 'cloudflare')
    throw new DnsError('CAPABILITY_UNSUPPORTED', 'CLI currently supports only cloudflare')
  const zoneValue = pick('zone', cli.zone, env.FLASH_DNS_ZONE, config.zone)
  if (!zoneValue)
    throw new DnsError('CONFIG_INVALID', 'zone is required')
  const zone = normalizeHostname(zoneValue)
  const configDir = input.configFile ? dirname(input.configFile) : resolve(input.cwd)
  const projectId = pick('project.id', cli.projectId, env.FLASH_DNS_PROJECT_ID, config.project?.id)
  const template = pick('naming.template', cli.template, env.FLASH_DNS_TEMPLATE, config.naming?.template, `{project}.${zone}`)!
  let hostname = pick('hostname', cli.hostname, env.FLASH_DNS_HOSTNAME, config.hostname)
  if (!hostname) {
    const variables: Record<string, string | undefined> = { ...config.variables }
    if (template.includes('{project}')) {
      let project = pick('project.name', cli.project, env.FLASH_DNS_PROJECT, config.project?.name)
      if (project === undefined) {
        const packageFile = join(configDir, 'package.json')
        if (existsSync(packageFile)) {
          try {
            const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as { name?: unknown }
            if (pkg.name !== undefined && typeof pkg.name !== 'string')
              throw new Error('Invalid name')
            project = pkg.name
            sources['project.name'] = packageFile
          }
          catch { throw new DnsError('CONFIG_INVALID', `Invalid package.json: ${packageFile}`) }
        }
        project ??= basename(configDir)
        sources['project.name'] ??= 'directory'
      }
      variables.project = normalizeProjectName(project)
    }
    if (template.includes('{branch}')) {
      variables.branch = cli.branch ?? env.FLASH_DNS_BRANCH ?? variables.branch
      if (variables.branch === undefined) {
        try {
          variables.branch = execFileSync('git', ['branch', '--show-current'], { cwd: input.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
        }
        catch { throw new DnsError('TEMPLATE_VARIABLE_MISSING', 'branch must be provided outside a Git checkout') }
      }
    }
    variables.session = cli.session ?? env.FLASH_DNS_SESSION ?? variables.session
    hostname = renderHostname(template, variables)
  }
  hostname = normalizeHostname(hostname, true)
  assertInZone(hostname, zone)
  const rawTtl = pick<string | number>('record.ttl', cli.ttl, env.FLASH_DNS_TTL, config.record?.ttl)
  const ttl = rawTtl === undefined ? undefined : rawTtl === 'auto' ? 'auto' as const : Number(rawTtl)
  if (ttl !== undefined && ttl !== 'auto' && (!Number.isInteger(ttl) || ttl <= 0))
    throw new DnsError('CONFIG_INVALID', 'record.ttl must be auto or a positive integer')
  const rawProxy = env.FLASH_DNS_PROXIED
  if (cli.proxied === undefined && rawProxy !== undefined && rawProxy !== 'true' && rawProxy !== 'false')
    throw new DnsError('CONFIG_INVALID', 'FLASH_DNS_PROXIED must be true or false')
  const proxied = pick('providers.cloudflare.proxied', cli.proxied, rawProxy === undefined ? undefined : rawProxy === 'true', config.providers?.cloudflare?.proxied)
  const type = pick('record.type', cli.type, env.FLASH_DNS_TYPE, config.record?.type)
  if (type !== undefined && !['A', 'AAAA', 'CNAME', 'TXT'].includes(type))
    throw new DnsError('CONFIG_INVALID', 'record.type must be A, AAAA, CNAME or TXT')
  return {
    provider,
    zone,
    hostname,
    projectId,
    type,
    content: pick('record.content', cli.content, env.FLASH_DNS_CONTENT, config.record?.content),
    ttl,
    proxied,
    zoneId: pick('providers.cloudflare.zoneId', cli.zoneId, env.CLOUDFLARE_ZONE_ID, config.providers?.cloudflare?.zoneId),
    sources,
    configDir
  }
}

export function desiredFromConfig(config: ReturnType<typeof resolveDnsConfig>): DesiredRecord<{ proxied?: boolean }> {
  if (!config.projectId || !config.type || config.content === undefined)
    throw new DnsError('CONFIG_INVALID', 'project.id, record.type and record.content are required; run init or supply explicit values')
  return {
    zone: config.zone,
    name: config.hostname,
    type: config.type as DesiredRecord['type'],
    content: config.content,
    owner: { application: 'flash-dns', id: config.projectId },
    ttl: config.ttl,
    providerOptions: config.proxied === undefined ? {} : { proxied: config.proxied }
  }
}
