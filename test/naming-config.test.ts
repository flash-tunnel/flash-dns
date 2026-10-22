import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertInZone, desiredFromConfig, findConfigFile, loadDnsConfig, normalizeContent, normalizeHostname, normalizeProjectName, renderHostname, resolveDnsConfig } from '@flash-dns/core'
import { afterEach, describe, expect, it } from 'vitest'

const temporary: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'flash-dns-test-'))
  temporary.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('naming', () => {
  it('renders the documented scoped project example', () => {
    expect(renderHostname('{project}.slidev.acewill.dev', { project: normalizeProjectName('@org-name/project-name') })).toBe('org-name-project-name.slidev.acewill.dev')
    expect(normalizeProjectName('@Org/Project')).toBe('org-project')
  })
  it('validates label boundaries without truncation or silent replacement', () => {
    expect(normalizeProjectName('a'.repeat(63))).toHaveLength(63)
    for (const name of ['a'.repeat(64), 'name_here', '-name', 'name-', '中文', 'a.b', ''])
      expect(() => normalizeProjectName(name)).toThrow()
  })
  it('rejects missing variables and label injection', () => {
    expect(() => renderHostname('{unknown}.example.com', {})).toThrow(/Missing template variable/)
    for (const variable of ['a.b', '*', 'feat/test'])
      expect(() => renderHostname('{branch}.example.com', { branch: variable })).toThrow()
  })
  it('validates explicit wildcards, total length and Zone boundaries', () => {
    expect(normalizeHostname('*.App.Example.com.', true)).toBe('*.app.example.com')
    expect(() => normalizeHostname('a.*.example.com', true)).toThrow()
    expect(() => normalizeHostname(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}`)).toThrow()
    expect(() => assertInZone('badexample.com', 'example.com')).toThrow()
    expect(() => assertInZone('example.com', 'example.com')).not.toThrow()
  })
  it('validates targets and preserves raw TXT', () => {
    expect(normalizeContent('CNAME', 'Target.Example.com.')).toBe('target.example.com')
    expect(normalizeContent('TXT', '"Mixed Case"')).toBe('"Mixed Case"')
    expect(normalizeContent('AAAA', '2001:0db8::0001')).toBe('2001:db8::1')
    for (const [type, content] of [['CNAME', 'https://example.com/path'], ['A', '::1'], ['AAAA', '192.0.2.1']])
      expect(() => normalizeContent(type!, content!)).toThrow()
  })
})

describe('configuration', () => {
  it('resolves CLI > env > file while preserving explicit false', () => {
    const config = resolveDnsConfig({
      cwd: '.',
      config: { zone: 'example.com', hostname: 'file.example.com', project: { id: 'p' }, record: { type: 'A', content: '192.0.2.1' }, providers: { cloudflare: { proxied: true } } },
      env: { FLASH_DNS_HOSTNAME: 'env.example.com', FLASH_DNS_PROXIED: 'true' },
      cli: { hostname: 'cli.example.com', proxied: false }
    })
    expect(config.hostname).toBe('cli.example.com')
    expect(config.proxied).toBe(false)
    expect(config.sources.hostname).toBe('cli')
    expect(desiredFromConfig(config).owner).toEqual({ application: 'flash-dns', id: 'p' })
  })
  it('loads TS defineConfig outside the installation tree (npx layout)', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'flash-dns.config.ts'), 'import { defineConfig } from \'flash-dns\'\nexport default defineConfig({ zone: \'example.com\', hostname: \'app.example.com\' })')
    const loaded = await loadDnsConfig(cwd)
    expect(loaded.config.zone).toBe('example.com')
    expect(loaded.configDir).toBe(cwd)
  })
  it('keeps arbitrary string values and resolves defineConfig imports in supporting modules', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'settings.ts'), 'import { defineConfig } from \'flash-dns/config\'\nexport default defineConfig({ zone: \'example.com\', record: { type: \'TXT\', content: \'flash-dns\' } })')
    await writeFile(join(cwd, 'flash-dns.config.ts'), 'export { default } from \'./settings\'')
    expect((await loadDnsConfig(cwd)).config.record?.content).toBe('flash-dns')
  })
  it('finds config upward but stops at a nested Git root', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'flash-dns.config.json'), '{}')
    await mkdir(join(cwd, 'nested', 'child'), { recursive: true })
    expect(findConfigFile(join(cwd, 'nested', 'child'))).toBe(join(cwd, 'flash-dns.config.json'))
    await mkdir(join(cwd, 'nested', '.git'))
    expect(findConfigFile(join(cwd, 'nested', 'child'))).toBeUndefined()
  })
  it('uses the config directory as the discovery base and reports invalid package JSON', async () => {
    const cwd = await fixture()
    const configFile = join(cwd, 'flash-dns.config.ts')
    await writeFile(join(cwd, 'package.json'), '{broken')
    expect(() => resolveDnsConfig({ cwd: join(cwd, 'child'), configFile, config: { zone: 'example.com' }, env: {} })).toThrow(/package.json/)
    // Explicit hostnames do not require project auto-detection.
    expect(resolveDnsConfig({ cwd, config: { zone: 'example.com', hostname: 'app.example.com' }, env: {} }).hostname).toBe('app.example.com')
  })
  it('rejects secrets, malformed values and missing identities with useful paths', async () => {
    const cwd = await fixture()
    await writeFile(join(cwd, 'flash-dns.config.json'), JSON.stringify({ zone: 'example.com', providers: { cloudflare: { apiToken: 'secret' } } }))
    await expect(loadDnsConfig(cwd)).rejects.toMatchObject({ code: 'CONFIG_INVALID', hint: expect.stringContaining('providers.cloudflare.apiToken') })
    expect(() => resolveDnsConfig({ cwd, config: { zone: 'example.com', hostname: 'app.example.com' }, cli: { ttl: 0 }, env: {} })).toThrow()
    expect(() => desiredFromConfig(resolveDnsConfig({ cwd, config: { zone: 'example.com', hostname: 'app.example.com' }, env: {} }))).toThrow(/project.id/)
  })
})
