import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = join(root, '.artifacts', 'packs')
const pnpm = process.env.npm_execpath
assert(pnpm, 'Run this script with pnpm run test:pack')
const pnpmCommand: [string, ...string[]] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, pnpm] : [pnpm]
const cleanEnv = { ...process.env, CLOUDFLARE_API_TOKEN: '', CI: '1', NO_COLOR: '1' }

function execute(command: string, args: string[], cwd: string, expected = 0): string {
  const result = spawnSync(command, args, { cwd, env: cleanEnv, encoding: 'utf8', timeout: 180_000 })
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
function runPnpm(args: string[], cwd: string, expected = 0): string {
  return execute(pnpmCommand[0], [...pnpmCommand.slice(1), ...args], cwd, expected)
}

async function main(): Promise<void> {
  await mkdir(artifacts, { recursive: true })
  const packages = ['types', 'config', 'core', 'adapter-cloudflare', 'cli', 'flash-dns']
  const versions: Record<string, string> = {}
  const tarballs: Record<string, string> = {}
  for (const directory of packages) {
    const location = join(root, 'packages', directory)
    const pkg = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'))
    versions[pkg.name] = pkg.version
    assert.equal(pkg.license, 'MIT')
    assert.equal(pkg.repository.type, 'git')
    assert.equal(pkg.repository.url, 'git+https://github.com/flash-tunnel/flash-dns.git')
    assert.equal(pkg.homepage, 'https://github.com/flash-tunnel/flash-dns#readme')
    assert.equal(pkg.bugs.url, 'https://github.com/flash-tunnel/flash-dns/issues')
    assert.equal(pkg.engines.node, '>=22.14.0')
    assert(!pkg.private)
    const pack = JSON.parse(runPnpm(['pack', '--json', '--pack-destination', artifacts], location))
    const filename = typeof pack.filename === 'string' ? pack.filename : undefined
    const tarball = filename ? resolve(location, filename) : join(artifacts, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`)
    assert(existsSync(tarball), `Missing tarball for ${pkg.name}`)
    const files = execute('tar', ['-tf', tarball], root).trim().split(/\r?\n/)
    assert(files.some(file => file.endsWith('dist/index.mjs')))
    assert(files.some(file => file.endsWith('dist/index.d.mts')))
    assert(files.some(file => file.endsWith('LICENSE')))
    const packedManifest = JSON.parse(execute('tar', ['-xOf', tarball, 'package/package.json'], root))
    const packedDependencies: Record<string, string> = packedManifest.dependencies ?? {}
    assert(!Object.values(packedDependencies).some(value => value.startsWith('workspace:')))
    assert(!files.some(file => /(?:^|\/)(?:src|test|node_modules|\.env|ai-docs)(?:\/|$)/.test(file)), `Unexpected source or private files in ${pkg.name}`)
    if (directory === 'flash-dns')
      assert(files.includes('package/bin/flash-dns.mjs'))
    tarballs[pkg.name] = `file:${tarball.replaceAll('\\', '/')}`
  }
  const temp = await mkdtemp(join(tmpdir(), 'flash-dns-pack-'))
  const tarballUrl = (name: string): string => {
    const url = tarballs[name]
    assert(url, `Missing tarball for ${name}`)
    return url
  }
  try {
    const install = async (name: string, dependencies: Record<string, string>): Promise<string> => {
      const dir = join(temp, name)
      await mkdir(dir)
      await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: `smoke-${name}`, private: true, type: 'module', dependencies }, null, 2)}\n`)
      await writeFile(join(dir, 'pnpm-workspace.yaml'), `overrides:\n${Object.entries(tarballs).map(([key, value]) => `  '${key}': '${value}'`).join('\n')}\n`)
      runPnpm(['install', '--ignore-scripts', '--prefer-offline'], dir)
      return dir
    }
    const sdk = await install('sdk', { '@flash-dns/core': tarballUrl('@flash-dns/core'), '@flash-dns/adapter-cloudflare': tarballUrl('@flash-dns/adapter-cloudflare') })
    const smoke = `import assert from 'node:assert/strict'
import { createDnsManager, normalizeProjectName } from '@flash-dns/core'
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
assert.equal(normalizeProjectName('@org/name'), 'org-name')
assert.equal(typeof createDnsManager({ adapter: createCloudflareAdapter({ apiToken: 'fixture' }) }).ensure, 'function')
`
    await writeFile(join(sdk, 'smoke.mjs'), smoke)
    execute(process.execPath, ['smoke.mjs'], sdk)
    assert(!existsSync(join(sdk, 'node_modules', '@flash-dns', 'cli')), 'SDK unexpectedly installed CLI')
    const virtualStore = await readdir(join(sdk, 'node_modules', '.pnpm'))
    assert(!virtualStore.some(name => name.startsWith('@flash-dns+cli') || name.startsWith('yocto-spinner') || name.startsWith('@inquirer+')))
    const cli = await install('cli', { 'flash-dns': tarballUrl('flash-dns'), '@flash-dns/core': tarballUrl('@flash-dns/core'), '@flash-dns/adapter-cloudflare': tarballUrl('@flash-dns/adapter-cloudflare') })
    assert.match(runPnpm(['exec', 'flash-dns', '--help'], cli), /init, plan, ensure, list, remove, doctor/)
    assert.equal(runPnpm(['exec', 'flash-dns', '--version'], cli).trim(), versions['flash-dns'])
    await writeFile(join(cli, 'imports.mjs'), 'import { defineConfig } from \'flash-dns\'; import { defineConfig as config } from \'flash-dns/config\'; if (defineConfig({}).zone !== config({}).zone) throw new Error(\'config mismatch\')\n')
    execute(process.execPath, ['imports.mjs'], cli)
    await writeFile(join(cli, 'types.mts'), `import { defineConfig } from 'flash-dns'
import { createDnsManager } from '@flash-dns/core'
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
defineConfig({ record: { type: 'TXT', content: 'hello' } })
const manager = createDnsManager({ adapter: createCloudflareAdapter({ apiToken: 'fixture' }) })
void manager.ensure({ zone: 'example.com', name: 'app.example.com', type: 'A', content: '192.0.2.1', owner: { application: 'smoke', id: 'p' }, providerOptions: { proxied: false } })
// @ts-expect-error Provider options remain typed through the manager.
void manager.ensure({ zone: 'example.com', name: 'app.example.com', type: 'A', content: '192.0.2.1', owner: { application: 'smoke', id: 'p' }, providerOptions: { unsupported: true } })
`)
    execute(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', join(cli, 'types.mts')], cli)
    // The project has no local installation. Only the temporary CLI tree can resolve flash-dns.
    const project = join(temp, 'project')
    await mkdir(project)
    runPnpm(['exec', 'flash-dns', 'init', '--cwd', project, '--json'], cli)
    const doctor = runPnpm(['exec', 'flash-dns', 'doctor', '--cwd', project, '--json'], cli, 4)
    assert.equal(JSON.parse(doctor.trim()).data.code, 'AUTH_INVALID')
    process.stdout.write(`Pack smoke passed: ${packages.length} tarballs, isolated SDK, CLI, declarations and npx-style TS configuration\n`)
  }
  finally {
    assert(resolve(temp).startsWith(`${resolve(tmpdir())}${sep}`) && basename(temp).startsWith('flash-dns-pack-'))
    await rm(temp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
