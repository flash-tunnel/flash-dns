import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { runCli } from '@flash-dns/cli'
import { afterEach, describe, expect, it } from 'vitest'
import { cloudflareFixture, owned } from './helpers/cloudflare'

const temporary: string[] = []
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'flash-dns-cli-'))
  temporary.push(cwd)
  return cwd
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

async function run(args: string[], f = cloudflareFixture(), cwd?: string) {
  cwd ??= await fixture()
  let stdout = ''
  let stderr = ''
  const code = await runCli([...args, '--cwd', cwd, '--json'], {
    env: { CLOUDFLARE_API_TOKEN: 'fixture-secret', CLOUDFLARE_ZONE_ID: 'zone-1', FLASH_DNS_ZONE: 'example.com', CI: '1' },
    fetcher: f.fetcher,
    stdout: (value) => { stdout += value },
    stderr: (value) => { stderr += value }
  })
  return { code, events: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)), stdout, stderr, f }
}

describe('cLI', () => {
  it('shows help with no command and does not send requests', async () => {
    const result = await run([])
    expect(result.code).toBe(0)
    expect(result.events[0]).toMatchObject({ event: 'help' })
    expect(result.f.calls).toHaveLength(0)
  })
  it('init creates one stable identity and refuses to overwrite it', async () => {
    const cwd = await fixture()
    expect((await run(['init'], undefined, cwd)).code).toBe(0)
    const first = await readFile(join(cwd, 'flash-dns.config.ts'), 'utf8')
    expect((await run(['init'], undefined, cwd)).code).toBe(2)
    expect(await readFile(join(cwd, 'flash-dns.config.ts'), 'utf8')).toBe(first)
  })
  it('supports JSON plan/ensure and returns a non-zero conflict plan', async () => {
    const args = ['--hostname', 'app.example.com', '--project-id', 'project-1', '--type', 'A', '--content', '192.0.2.1']
    const f = cloudflareFixture()
    const created = await run(['ensure', ...args], f)
    expect(created.code).toBe(0)
    expect(created.events[0].data.action).toBe('created')
    expect(created.stderr).toBe('')
    const conflictArgs = args.map(value => value === 'project-1' ? 'other' : value)
    const conflict = await run(['plan', ...conflictArgs], f)
    expect(conflict.code).toBe(3)
    expect(conflict.events[0].data.operation).toBe('conflict')
  })
  it('rejects non-interactive remove without yes and protects other owners', async () => {
    const f = cloudflareFixture([owned()])
    const args = ['remove', '--record-id', 'record-1', '--owner-id', 'project-1', '--owner-application', 'test-app']
    expect((await run(args, f)).code).toBe(2)
    expect(f.records.size).toBe(1)
    expect((await run([...args, '--yes'], f)).code).toBe(0)
    expect(f.records.size).toBe(0)
    expect((await run([...args, '--yes'], f)).events[0].data.action).toBe('already-absent')
    const other = cloudflareFixture([owned()])
    expect((await run(['remove', '--record-id', 'record-1', '--owner-id', 'other', '--yes'], other)).code).toBe(3)
    expect(other.records.size).toBe(1)
  })
  it('doctor verifies actual reads without writing and list filters names and owners', async () => {
    const f = cloudflareFixture([owned()])
    expect((await run(['doctor'], f)).events[0].data).toMatchObject({ ok: true, writePermission: 'not-tested' })
    expect((await run(['list', '--name', 'app.example.com', '--owner-id', 'project-1', '--owner-application', 'test-app'], f)).events[0].data).toHaveLength(1)
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('requires every supplied deletion selector to match', async () => {
    const f = cloudflareFixture([owned()])
    const result = await run(['remove', '--record-id', 'record-1', '--name', 'different.example.com', '--owner-id', 'project-1', '--owner-application', 'test-app', '--yes'], f)
    expect(result.code).toBe(6)
    expect(f.records.size).toBe(1)
    expect(f.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('removes by the configured hostname template without a record ID', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'flash-dns.config.json'), JSON.stringify({ zone: 'example.com', project: { name: 'app', id: 'project-1' }, naming: { template: '{project}.example.com' } }))
    const f = cloudflareFixture([owned()])
    const result = await run(['remove', '--owner-application', 'test-app', '--yes'], f, cwd)
    expect(result.code).toBe(0)
    expect(f.records.size).toBe(0)
  })
  it('returns 130 on cancellation and does not remove signal handlers owned by the caller', async () => {
    const listeners = process.listeners('SIGINT')
    let output = ''
    const code = await runCli(['doctor', '--zone', 'example.com', '--json'], {
      env: { CLOUDFLARE_API_TOKEN: 'fixture-secret' },
      signal: AbortSignal.abort(),
      stdout: (value) => { output += value },
      stderr: () => {}
    })
    expect(code).toBe(130)
    expect(JSON.parse(output).data.code).toBe('OPERATION_ABORTED')
    expect(process.listeners('SIGINT')).toEqual(listeners)
  })
  it('rejects unknown arguments and credential flags, maps auth errors and never leaks secrets', async () => {
    expect((await run(['ensure', '--api-token', 'fixture-secret'])).code).toBe(2)
    const f = cloudflareFixture()
    f.failures.push({ method: 'GET', status: 401 })
    const result = await run(['doctor'], f)
    expect(result.code).toBe(4)
    expect(result.stdout + result.stderr).not.toContain('fixture-secret')
  })
  it('loads configuration and preserves false proxy overrides', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'flash-dns.config.ts'), `import { defineConfig } from 'flash-dns/config'
export default defineConfig({ zone: 'example.com', hostname: 'app.example.com', project: { id: 'p' }, record: { type: 'A', content: '192.0.2.1' }, providers: { cloudflare: { proxied: true } } })`)
    const result = await run(['ensure', '--proxied', 'false'], undefined, cwd)
    expect(result.code).toBe(0)
    expect(result.f.calls.find(call => call.method === 'POST')?.body?.proxied).toBe(false)
  })
})
