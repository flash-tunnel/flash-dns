import type { CliOverrides } from '@flash-dns/core'
import type { OperationContext, Ownership, RecordRef } from '@flash-dns/types'
import type { Command } from 'cac'
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

type CommandName = 'init' | 'plan' | 'ensure' | 'list' | 'remove' | 'doctor'
type TextValue = string | number

interface CliOptions {
  cwd?: TextValue
  config?: TextValue
  provider?: TextValue
  zone?: TextValue
  zoneId?: TextValue
  hostname?: TextValue
  project?: TextValue
  projectId?: TextValue
  template?: TextValue
  branch?: TextValue
  session?: TextValue
  type?: TextValue
  content?: TextValue
  ttl?: TextValue
  proxied?: TextValue
  recordId?: TextValue
  name?: TextValue
  ownerId?: TextValue
  ownerApplication?: TextValue
  json?: boolean
  silent?: boolean
  verbose?: boolean
  yes?: boolean
  color?: boolean
  help?: boolean
  version?: boolean
}

function withConfigOptions(command: Command): Command {
  return command
    .option('--cwd <path>', 'Working directory')
    .option('--config <path>', 'Configuration file')
}

function withDnsOptions(command: Command): Command {
  return withConfigOptions(command)
    .option('--provider <name>', 'DNS provider override')
    .option('--zone <domain>', 'DNS zone name')
    .option('--zone-id <id>', 'Cloudflare zone ID')
    .option('--hostname <name>', 'Complete hostname')
    .option('--project <name>', 'Project name')
    .option('--project-id <id>', 'Stable project identity')
    .option('--template <text>', 'Naming template')
    .option('--branch <label>', 'Branch template variable')
    .option('--session <label>', 'Session template variable')
}

function withRecordOptions(command: Command): Command {
  return withDnsOptions(command)
    .option('--type <type>', 'A AAAA CNAME or TXT')
    .option('--content <text>', 'Record target or text')
    .option('--ttl <value>', 'auto or seconds')
    .option('--proxied <value>', 'true or false')
    .option('--record-id <id>', 'Select one record')
}

/** cac prints help and version with console.info; capture it so --json and injected streams stay clean. */
function captureInfo<T>(work: () => T): { result: T, text: string } {
  let text = ''
  const info = console.info
  console.info = (...args: unknown[]): void => {
    text += `${args.map(value => String(value)).join(' ')}\n`
  }
  try {
    const result = work()
    return { result, text: text.trimEnd() }
  }
  finally {
    console.info = info
  }
}

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
  let pending: Promise<number> | undefined

  const execute = async (command: CommandName, options: CliOptions): Promise<number> => {
    const textFlag = (key: keyof CliOptions): string | undefined => {
      const value = options[key]
      if (value === undefined)
        return undefined
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new DnsError('CONFIG_INVALID', `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} requires a value`)
      return String(value)
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
    const overrides: CliOverrides = {}
    for (const key of ['provider', 'zone', 'hostname', 'project', 'projectId', 'template', 'type', 'content', 'ttl', 'zoneId', 'branch', 'session'] as const) {
      const value = textFlag(key)
      if (value !== undefined)
        overrides[key] = value
    }
    if (options.proxied !== undefined) {
      if (!['true', 'false'].includes(String(options.proxied)))
        throw new DnsError('CONFIG_INVALID', '--proxied requires true or false')
      overrides.proxied = String(options.proxied) === 'true'
    }
    // Read-only commands and exact-ID removal do not need project-name detection.
    if (['doctor', 'list'].includes(command) || (command === 'remove' && textFlag('recordId')))
      overrides.hostname ??= textFlag('name') ?? overrides.zone ?? env.FLASH_DNS_ZONE ?? loaded.config.zone
    else if (command === 'remove' && textFlag('name'))
      overrides.hostname = textFlag('name')
    const config = resolveDnsConfig({ cwd, config: loaded.config, configFile: loaded.source, env, cli: overrides })
    const adapter = createCloudflareAdapter({ apiToken: env.CLOUDFLARE_API_TOKEN ?? '', zoneId: config.zoneId, fetcher: runtime.fetcher })
    const manager = createDnsManager({ adapter })
    if (interactive && !silent)
      spinner = yoctoSpinner({ text: `flash-dns ${command}`, stream: process.stderr }).start()
    if (command === 'plan' || command === 'ensure') {
      const desired = desiredFromConfig(config)
      desired.recordId = textFlag('recordId')
      const result = command === 'plan' ? await manager.plan(desired, context) : await manager.ensure(desired, context)
      spinner?.stop()
      output(command, options.verbose ? { ...result, sources: config.sources } : result)
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
          if (!recordId && !textFlag('name') && !overrides.hostname && !loaded.config.hostname && !loaded.config.naming?.template)
            throw new DnsError('CONFIG_INVALID', 'remove requires --record-id or an explicit hostname/template selector')
          if (records.some(record => !sameOwner(record.ownership, owner)) && (recordId || !filtered.length))
            throw new DnsError('OWNERSHIP_MISMATCH', 'Selected record has a different owner')
          if (recordId && records.length && !filtered.length)
            throw new DnsError('RECORD_NOT_FOUND', 'Record ID does not match all supplied selectors')
          if (filtered.length > 1)
            throw new DnsError('AMBIGUOUS_RECORD', 'Select exactly one record using --record-id')
          if (!interactive && !options.yes)
            throw new DnsError('CONFIG_INVALID', 'Non-interactive remove requires --yes')
          const record = filtered[0]
          const target: RecordRef = {
            provider: adapter.id,
            zoneId: zone.id,
            recordId: record?.id ?? recordId ?? '',
            owner,
            ...(record ? { snapshot: { name: record.name, type: record.type, content: record.content } } : {})
          }
          if (!options.yes && record) {
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

  const dispatch = (command: CommandName, options: CliOptions): void => {
    if (options.help || options.version)
      return
    pending = execute(command, options)
  }

  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  try {
    const cli = cac('flash-dns')

    cli.option('--json', 'NDJSON output with no interaction')
    cli.option('--silent', 'Suppress human progress output')
    cli.option('--no-color', 'Disable colors')

    withConfigOptions(cli.command('init', 'Create a starter config file'))
      .action((options: CliOptions = {}): void => dispatch('init', options))

    withRecordOptions(cli.command('plan', 'Preview DNS changes without writing'))
      .option('--verbose', 'Include configuration field sources')
      .action((options: CliOptions = {}): void => dispatch('plan', options))

    withRecordOptions(cli.command('ensure', 'Create or update the managed DNS record'))
      .option('--verbose', 'Include configuration field sources')
      .action((options: CliOptions = {}): void => dispatch('ensure', options))

    withDnsOptions(cli.command('list', 'List records for the configured selector'))
      .option('--name <name>', 'Hostname filter')
      .option('--owner-id <id>', 'Owner ID filter')
      .option('--owner-application <name>', 'Owner application (default flash-dns)')
      .action((options: CliOptions = {}): void => dispatch('list', options))

    withDnsOptions(cli.command('remove', 'Delete one record owned by the project'))
      .option('--record-id <id>', 'Select one record')
      .option('--name <name>', 'Hostname filter')
      .option('--owner-id <id>', 'Owner ID filter')
      .option('--owner-application <name>', 'Owner application (default flash-dns)')
      .option('--yes', 'Confirm deletion without interaction')
      .action((options: CliOptions = {}): void => dispatch('remove', options))

    withDnsOptions(cli.command('doctor', 'Check credentials zone and DNS access'))
      .action((options: CliOptions = {}): void => dispatch('doctor', options))

    cli.help()
    cli.version(version)

    const { result: parsed, text: printed } = captureInfo(() => {
      try {
        return cli.parse(['node', 'flash-dns', ...argv])
      }
      catch {
        return undefined
      }
    })
    if (!parsed)
      throw new DnsError('CONFIG_INVALID', 'Invalid command arguments; use --help')
    const flags = parsed.options as Record<string, unknown>
    if (flags.version) {
      output('version', version)
      return 0
    }
    if (flags.help) {
      output('help', printed)
      return 0
    }
    if (!cli.matchedCommand) {
      if (parsed.args.length)
        throw new DnsError('CONFIG_INVALID', 'Unknown command; use --help')
      output('help', captureInfo(() => cli.outputHelp()).text)
      return 0
    }
    return pending ? await pending : 0
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
