import type { CliOverrides } from '@flash-dns/core'
import type { OperationContext, Ownership, RecordRef } from '@flash-dns/types'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
import { createDnsManager, desiredFromConfig, loadDnsConfig, normalizeHostname, resolveDnsConfig } from '@flash-dns/core'
import { DnsError, sameOwner } from '@flash-dns/types'
import { confirm as promptConfirm } from '@inquirer/prompts'
import { cac } from 'cac'
import yoctoSpinner from 'yocto-spinner'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const help = `flash-dns ${version}
Usage: flash-dns <command> [options]

Commands: init, plan, ensure, list, remove, doctor

Options:
  --cwd <path>       Working directory
  --config <path>    Configuration file
  --zone <domain>    DNS Zone name
  --zone-id <id>     Cloudflare Zone ID
  --hostname <name>  Complete hostname
  --project <name>   Project name
  --project-id <id>  Stable project identity
  --template <text>  Naming template
  --branch <label>   Branch template variable
  --session <label>  Session template variable
  --type <type>      A, AAAA, CNAME or TXT
  --content <text>   Record target or text
  --ttl <value>      auto or seconds
  --proxied <value>  true or false
  --record-id <id>   Select one record
  --name <name>      list/remove hostname filter
  --owner-id <id>    list/remove owner ID
  --owner-application <name>  Owner application (default flash-dns)
  --json            NDJSON output, no interaction
  --silent          Suppress human progress output
  --verbose         Include configuration field sources
  --no-color        Disable colors
  --yes             Confirm deletion without interaction
  --help, --version

Credentials: CLOUDFLARE_API_TOKEN (environment only)
`

export function exitCode(error: DnsError): number {
  if (['CONFIG_INVALID', 'NAME_INVALID', 'TEMPLATE_VARIABLE_MISSING'].includes(error.code))
    return 2
  if (['RECORD_CONFLICT', 'OWNERSHIP_MISMATCH', 'AMBIGUOUS_RECORD', 'PLAN_STALE'].includes(error.code))
    return 3
  if (['AUTH_INVALID', 'PERMISSION_DENIED'].includes(error.code))
    return 4
  if (['ADAPTER_INCOMPATIBLE', 'CAPABILITY_UNSUPPORTED'].includes(error.code))
    return 5
  if (['ZONE_NOT_FOUND', 'ZONE_NOT_ACTIVE', 'RECORD_NOT_FOUND'].includes(error.code))
    return 6
  if (['RATE_LIMITED', 'REQUEST_TIMEOUT'].includes(error.code))
    return 7
  return error.code === 'OPERATION_ABORTED' ? 130 : 1
}

export interface RunCliOptions {
  env?: Record<string, string | undefined>
  stdout?: (text: string) => void
  stderr?: (text: string) => void
  isTTY?: boolean
  fetcher?: typeof fetch
  signal?: AbortSignal
  confirm?: (message: string) => Promise<boolean>
}

export async function runCli(argv = process.argv.slice(2), runtime: RunCliOptions = {}): Promise<number> {
  const env = runtime.env ?? process.env
  const stdout = runtime.stdout ?? ((text: string): void => {
    process.stdout.write(text)
  })
  const stderr = runtime.stderr ?? ((text: string): void => {
    process.stderr.write(text)
  })
  const json = argv.includes('--json')
  const silent = argv.includes('--silent')
  const interactive = (runtime.isTTY ?? (process.stdin.isTTY && process.stderr.isTTY)) && !env.CI && !json
  const controller = new AbortController()
  const signal = runtime.signal ? AbortSignal.any([runtime.signal, controller.signal]) : controller.signal
  const cancel = (): void => controller.abort()
  const requestId = randomUUID()
  const context: OperationContext = { signal, requestId }
  const redact = (text: string): string => env.CLOUDFLARE_API_TOKEN ? text.replaceAll(env.CLOUDFLARE_API_TOKEN, '[REDACTED]') : text
  const output = (event: string, data: unknown): void => {
    if (json)
      stdout(`${redact(JSON.stringify({ event, requestId, data }))}\n`)
    else if (!silent)
      stdout(`${redact(typeof data === 'string' ? data : JSON.stringify(data, null, 2))}\n`)
  }
  let spinner: ReturnType<typeof yoctoSpinner> | undefined
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  try {
    const parser = cac('flash-dns')
    const valueOptions = ['cwd', 'config', 'provider', 'zone', 'hostname', 'project', 'project-id', 'template', 'type', 'content', 'ttl', 'zone-id', 'proxied', 'branch', 'session', 'record-id', 'name', 'owner-id', 'owner-application']
    for (const flag of valueOptions) parser.option(`--${flag} <value>`, flag)
    for (const flag of ['json', 'silent', 'verbose', 'yes', 'help', 'version', 'no-color']) parser.option(`--${flag}`, flag)
    let parsed: ReturnType<typeof parser.parse>
    try {
      parsed = parser.parse(['node', 'flash-dns', ...argv], { run: false })
    }
    catch { throw new DnsError('CONFIG_INVALID', 'Invalid command arguments; use --help') }
    const flags = parsed.options as Record<string, unknown>
    const knownFlags = new Set([...valueOptions.map(v => v.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())), 'json', 'silent', 'verbose', 'yes', 'help', 'version', 'color', '--'])
    if (Object.keys(flags).some(key => !knownFlags.has(key)))
      throw new DnsError('CONFIG_INVALID', 'Unknown command option; use --help')
    if (flags.version) {
      output('version', version)
      return 0
    }
    if (flags.help || !parsed.args.length) {
      output('help', help)
      return 0
    }
    const command = parsed.args[0]
    if (parsed.args.length !== 1 || !['init', 'plan', 'ensure', 'list', 'remove', 'doctor'].includes(command!))
      throw new DnsError('CONFIG_INVALID', 'Unknown command; use --help')
    const textFlag = (key: string): string | undefined => {
      if (flags[key] === undefined)
        return undefined
      if (typeof flags[key] !== 'string' && typeof flags[key] !== 'number')
        throw new DnsError('CONFIG_INVALID', `--${key} requires a value`)
      return String(flags[key])
    }
    const cwd = resolve(textFlag('cwd') ?? process.cwd())
    if (command === 'init') {
      const path = resolve(cwd, textFlag('config') ?? 'flash-dns.config.ts')
      if (existsSync(path))
        throw new DnsError('CONFIG_INVALID', 'Configuration already exists; init will not overwrite it')
      if (!/\.(?:ts|mts|js|mjs)$/.test(path))
        throw new DnsError('CONFIG_INVALID', 'init requires a ts, mts, js or mjs config path')
      await mkdir(cwd, { recursive: true })
      const projectId = randomUUID()
      const source = `import { defineConfig } from 'flash-dns'\n\nexport default defineConfig({\n  provider: 'cloudflare',\n  zone: 'example.com',\n  project: { id: '${projectId}' },\n  naming: { template: '{project}.example.com' },\n  record: { type: 'A', content: '192.0.2.1', ttl: 'auto' }\n})\n`
      await writeFile(path, source, { flag: 'wx' })
      output('init', { path, projectId, hint: 'Set your Zone, naming template and record content before running plan' })
      return 0
    }
    const loaded = await loadDnsConfig(cwd, textFlag('config'))
    const cli: CliOverrides = {}
    for (const key of ['provider', 'zone', 'hostname', 'project', 'projectId', 'template', 'type', 'content', 'ttl', 'zoneId', 'branch', 'session'] as const) {
      const value = textFlag(key)
      if (value !== undefined)
        cli[key] = value
    }
    if (flags.proxied !== undefined) {
      if (!['true', 'false'].includes(String(flags.proxied)))
        throw new DnsError('CONFIG_INVALID', '--proxied requires true or false')
      cli.proxied = String(flags.proxied) === 'true'
    }
    // Read-only commands and exact-ID removal do not need project-name detection.
    if (['doctor', 'list'].includes(command!) || (command === 'remove' && textFlag('recordId')))
      cli.hostname ??= textFlag('name') ?? cli.zone ?? env.FLASH_DNS_ZONE ?? loaded.config.zone
    else if (command === 'remove' && textFlag('name'))
      cli.hostname = textFlag('name')
    const config = resolveDnsConfig({ cwd, config: loaded.config, configFile: loaded.source, env, cli })
    const adapter = createCloudflareAdapter({ apiToken: env.CLOUDFLARE_API_TOKEN ?? '', zoneId: config.zoneId, fetcher: runtime.fetcher })
    const manager = createDnsManager({ adapter })
    if (interactive && !silent)
      spinner = yoctoSpinner({ text: `flash-dns ${command}`, stream: process.stderr }).start()
    if (command === 'plan' || command === 'ensure') {
      const desired = desiredFromConfig(config)
      desired.recordId = textFlag('recordId')
      const result = command === 'plan' ? await manager.plan(desired, context) : await manager.ensure(desired, context)
      spinner?.stop()
      output(command, flags.verbose ? { ...result, sources: config.sources } : result)
      if ('conflict' in result && result.conflict)
        return exitCode(new DnsError(result.conflict.code, result.conflict.message))
    }
    else {
      const zone = await adapter.resolveZone(config.zone, context)
      if (command === 'doctor') {
        await adapter.listRecords(zone.id, config.hostname, context)
        spinner?.stop()
        output('doctor', { ok: true, provider: adapter.id, zone, dnsRead: true, writePermission: 'not-tested' })
      }
      else {
        const ownerId = textFlag('ownerId') ?? (command === 'remove' ? config.projectId : undefined)
        const owner: Ownership | undefined = ownerId ? { application: textFlag('ownerApplication') ?? 'flash-dns', id: ownerId } : undefined
        const recordId = textFlag('recordId')
        const name = textFlag('name') ?? (command === 'remove' && !recordId ? config.hostname : undefined)
        const records = recordId
          ? [await adapter.getRecord(zone.id, recordId, context)].filter(v => v !== undefined)
          : await adapter.listRecords(zone.id, name ? normalizeHostname(name, true) : undefined, context)
        const filtered = records.filter(record => (!name || record.name === normalizeHostname(name, true)) && (!owner || sameOwner(record.ownership, owner)))
        spinner?.stop()
        if (command === 'list') {
          output('list', filtered)
        }
        else {
          if (!owner)
            throw new DnsError('CONFIG_INVALID', 'remove requires project.id or --owner-id')
          if (!recordId && !textFlag('name') && !cli.hostname && !loaded.config.hostname && !loaded.config.naming?.template)
            throw new DnsError('CONFIG_INVALID', 'remove requires --record-id or an explicit hostname/template selector')
          if (records.some(record => !sameOwner(record.ownership, owner)) && (recordId || !filtered.length))
            throw new DnsError('OWNERSHIP_MISMATCH', 'Selected record has a different owner')
          if (recordId && records.length && !filtered.length)
            throw new DnsError('RECORD_NOT_FOUND', 'Record ID does not match all supplied selectors')
          if (filtered.length > 1)
            throw new DnsError('AMBIGUOUS_RECORD', 'Select exactly one record using --record-id')
          if (!interactive && !flags.yes)
            throw new DnsError('CONFIG_INVALID', 'Non-interactive remove requires --yes')
          const record = filtered[0]
          const target: RecordRef = {
            provider: adapter.id,
            zoneId: zone.id,
            recordId: record?.id ?? recordId ?? '',
            owner,
            ...(record ? { snapshot: { name: record.name, type: record.type, content: record.content } } : {})
          }
          if (!flags.yes && record) {
            const message = `Delete ${record.type} ${record.name} → ${record.content} (ID ${record.id}, owner ${owner.application}/${owner.id})?`
            const accepted = runtime.confirm ? await runtime.confirm(message) : await promptConfirm({ message }, { signal })
            if (!accepted)
              throw new DnsError('OPERATION_ABORTED', 'Deletion cancelled')
          }
          output('remove', record || recordId ? await manager.remove(target, context) : { action: 'already-absent' })
        }
      }
    }
    return 0
  }
  catch (cause) {
    spinner?.stop()
    const error = signal.aborted
      ? new DnsError('OPERATION_ABORTED', 'Operation cancelled')
      : cause instanceof DnsError ? cause : new DnsError('PROVIDER_ERROR', 'Command failed', { hint: 'Check the configuration and retry' })
    const data = { code: error.code, message: error.message, hint: error.hint, retriable: error.retriable }
    if (json)
      output('error', data)
    else stderr(`${redact(`${data.code}: ${data.message}${data.hint ? `\n${data.hint}` : ''}`)}\n`)
    return exitCode(error)
  }
  finally {
    spinner?.stop()
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
  }
}
