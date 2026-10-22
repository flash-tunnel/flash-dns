# flash-dns

**Project-based DNS records for automated deployments.**

flash-dns turns a project identity and a naming rule into a DNS record: it normalizes `@org-name/project-name` to `org-name-project-name`, renders a hostname such as `org-name-project-name.preview.example.com`, and reconciles A / AAAA / CNAME / TXT records through a provider adapter. Use the CLI in a terminal or embed the SDK in a deployment tool. flash-dns manages authoritative DNS records only — it is not a resolver, a tunnel manager, or a deployment system.

**English** | [简体中文](https://github.com/flash-tunnel/flash-dns/blob/main/README_CN.md)

[![npm version](https://img.shields.io/npm/v/flash-dns?style=flat-square&color=blue)](https://www.npmjs.com/package/flash-dns)
[![npm downloads](https://img.shields.io/npm/dm/flash-dns?style=flat-square)](https://www.npmjs.com/package/flash-dns)
[![license](https://img.shields.io/npm/l/flash-dns?style=flat-square)](https://github.com/flash-tunnel/flash-dns/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/flash-dns?style=flat-square)](https://www.npmjs.com/package/flash-dns)

> Early preview (`0.1.x`). The core is provider-agnostic, but Cloudflare is the only adapter today. Review changes with `plan` before using it in production.

## Why flash-dns

- **One naming rule everywhere** — `{project}`, `{branch}`, `{session}` and custom variables turn a project identity into a repeatable hostname.
- **Safe with existing DNS** — records carry a versioned owner marker. Unmanaged records are never adopted, foreign-owned records are never modified, and deletion is by exact ID with a snapshot check.
- **Idempotent by design** — `plan` shows `create` / `update` / `noop` / `conflict` without writing. A second `ensure` with the same input is a no-op and keeps the record ID.
- **Updates in place** — `PATCH` changes only the requested fields, preserving user notes, tags and unset TTL or proxy settings.
- **Built for automation** — NDJSON output, stable exit codes, and `AbortSignal` support in every SDK call.
- **Clear boundary** — DNS only: no tunnels, app processes, certificates, or implicit cleanup on exit.

## How it works

1. Load settings from CLI flags, environment variables and the config file, in that order.
2. Normalize the project name and render the hostname from a template — or use an explicit hostname — then validate labels and the zone boundary.
3. Resolve the Cloudflare zone and read the records already at that name.
4. Classify the change as `create`, `update`, `noop` or `conflict` from the owner and record values.
5. For `ensure`, re-check the state, create or patch by ID, read the record back, and return a serializable `ref` for later removal.

## Requirements

- Node.js **>= 22.14**
- A Cloudflare account, an active zone, and an API token with DNS access to it
- No `cloudflared` or other external binary

## Install

```bash
# Run without installing
npx flash-dns --help

# Install the CLI globally
npm install -g flash-dns

# Pin a version in a project (recommended for CI)
pnpm add -D flash-dns
```

For the SDK, install the core and the adapter you need:

```bash
pnpm add @flash-dns/core @flash-dns/adapter-cloudflare
```

## Quick start

```bash
# macOS / Linux
export CLOUDFLARE_API_TOKEN=your_token_here

# Windows PowerShell
$env:CLOUDFLARE_API_TOKEN = "your_token_here"
```

Create a config with a stable project identity:

```bash
npx flash-dns init
```

Then set the zone, naming rule and record target:

```ts
// flash-dns.config.ts
import { defineConfig } from 'flash-dns'

export default defineConfig({
  zone: 'example.com',
  project: {
    name: '@org-name/project-name',
    id: 'gitlab:acewill/slides/project-name'
  },
  naming: { template: '{project}.preview.example.com' },
  record: { type: 'A', content: '192.0.2.1' }
})
```

This config manages `org-name-project-name.preview.example.com`.

```bash
npx flash-dns plan     # read-only: shows create / update / noop / conflict
npx flash-dns ensure   # reconcile the record
npx flash-dns doctor   # verify token, zone and DNS read access
```

`init` generates `project.id` once and refuses to overwrite an existing file. Keep that ID stable: it is the record's owner identity. `192.0.2.1` is a documentation address.

## Commands

| Command | Description |
| --- | --- |
| `flash-dns init` | Create `flash-dns.config.ts` with a generated `project.id`; never overwrites |
| `flash-dns plan` | Show the effective hostname, target record and `create` / `update` / `noop` / `conflict`; never writes |
| `flash-dns ensure` | Reconcile one record; re-checks before writing and verifies the result |
| `flash-dns list` | List records in the zone, filtered by `--name` and/or `--owner-id` |
| `flash-dns remove` | Delete exactly one matching, owned record; idempotent when already absent |
| `flash-dns doctor` | Check config, token, zone and DNS read access; does not test writes |

Interactive `remove` prints the target record and asks for confirmation; non-interactive runs require `--yes`. Running `flash-dns` with no command prints help and exits `0`.

## Options

Options override environment variables and config values. `flash-dns --help` prints the built-in list.

### Common options

| Option | Description |
| --- | --- |
| `--cwd <dir>` | Working directory and config discovery base |
| `--config <path>` | Explicit config file, resolved from `--cwd` |
| `--json` | Emit NDJSON and disable prompts and spinners |
| `--silent` | Suppress human output |
| `--verbose` | Add field sources to `plan` and `ensure` output |
| `--no-color` | Disable colors |
| `--yes` | Skip confirmation prompts (required for non-interactive `remove`) |
| `--help`, `--version` | Print help or version |

### Selection and record options

| Option | Description |
| --- | --- |
| `--provider <name>` | Provider ID; only `cloudflare` is supported |
| `--zone <domain>` | Zone name, for example `example.com` |
| `--zone-id <id>` | Cloudflare zone ID; skips lookup by name |
| `--hostname <fqdn>` | Complete hostname; takes precedence over the template |
| `--project <name>` | Project name used by `{project}` |
| `--project-id <id>` | Stable owner ID |
| `--template <text>` | Naming template |
| `--branch <label>` | Value for `{branch}`; otherwise read from Git |
| `--session <label>` | Value for `{session}` |
| `--type <type>` | `A`, `AAAA`, `CNAME` or `TXT` |
| `--content <text>` | Record content |
| `--ttl <value>` | `auto` or a number of seconds |
| `--proxied <value>` | `true` or `false`; Cloudflare proxy only |
| `--record-id <id>` | Select one existing record |
| `--name <fqdn>` | Hostname filter for `list`; selector for `remove` |
| `--owner-id <id>` | Owner ID filter for `list`; owner selector for `remove` |
| `--owner-application <name>` | Owner application for `list` and `remove` (default `flash-dns`) |

## Configuration

flash-dns looks for `flash-dns.config.{ts,mts,js,mjs,json}` in the working directory, then upward until the Git root or the filesystem root. `--config` selects a file explicitly.

Precedence: **CLI > environment variables > config file > auto-detection and defaults.** Explicit `false` and `0` are real values, not "unset".

```ts
// flash-dns.config.ts
import { defineConfig } from 'flash-dns'

export default defineConfig({
  provider: 'cloudflare',
  zone: 'example.com',

  // hostname: 'preview.example.com', // wins over naming.template
  project: {
    name: '@org-name/project-name',
    id: 'gitlab:acewill/slides/project-name'
  },

  naming: { template: '{project}.{namespace}.example.com' },
  variables: { namespace: 'preview' },

  record: {
    type: 'CNAME',
    content: 'target.example.com',
    ttl: 'auto'
  },

  providers: {
    cloudflare: {
      zoneId: 'optional-zone-id',
      proxied: false
    }
  }
})
```

- `provider` defaults to `cloudflare`; no other provider is available yet.
- `zone` is required, and the zone must be active in Cloudflare.
- `project.id` is the stable owner identity. `plan` and `ensure` require it; `remove` accepts it or `--owner-id`.
- `project.name` fills `{project}`. When omitted, it comes from `package.json` in the config directory, then the directory name.
- `naming.template` defaults to `{project}` plus the zone name.
- `hostname` bypasses the template and variables but is still validated.
- `variables` supplies custom template values.
- `record.type` and `record.content` are required for `plan` and `ensure`.
- `record.ttl` accepts `auto` or a number of seconds.
- `providers.cloudflare.zoneId` is optional; without it, the zone is resolved by name.
- `providers.cloudflare.proxied` is only applied when explicitly set.

Unknown fields are rejected. The config file is trusted code and is executed when loaded, so do not load untrusted config files.

### Environment variables

| Variable | Maps to |
| --- | --- |
| `FLASH_DNS_PROVIDER` | `provider` |
| `FLASH_DNS_ZONE` | `zone` |
| `FLASH_DNS_HOSTNAME` | `hostname` |
| `FLASH_DNS_PROJECT` | `project.name` |
| `FLASH_DNS_PROJECT_ID` | `project.id` |
| `FLASH_DNS_TEMPLATE` | `naming.template` |
| `FLASH_DNS_BRANCH` | `{branch}` value |
| `FLASH_DNS_SESSION` | `{session}` value |
| `FLASH_DNS_TYPE` | `record.type` |
| `FLASH_DNS_CONTENT` | `record.content` |
| `FLASH_DNS_TTL` | `record.ttl` |
| `FLASH_DNS_PROXIED` | `providers.cloudflare.proxied`; `true` or `false` |
| `CLOUDFLARE_ZONE_ID` | `providers.cloudflare.zoneId` |
| `CLOUDFLARE_API_TOKEN` | Adapter credential; never enters the resolved config |

### Naming rules

`{project}`, `{branch}`, `{session}` and any key in `variables` are available in templates. Only `{project}` is normalized automatically.

| Input | Label |
| --- | --- |
| `@org-name/project-name` | `org-name-project-name` |
| `@Org/Project` | `org-project` |

Different inputs can produce the same label, for example `@org/name` and `org-name`. They are still separate projects: ownership always uses `project.id`, and a matching label with a different owner is a conflict, not a silent takeover.

A label is 1–63 characters long, may contain lowercase letters, digits and hyphens, and must start and end with a letter or digit. Other characters and over-long labels fail instead of being rewritten or truncated.

- `{branch}` is read with `git branch --show-current` only when the template references it. Pass `--branch` or `FLASH_DNS_BRANCH` in CI.
- Every template value must be a single valid label. A branch named `feat/login` must be passed as `feat-login`; slashes are not rewritten.
- An explicit hostname may start with `*.`; template variables cannot inject a wildcard or an extra level.
- The hostname must be the zone itself or end with `.${zone}`; a plain string suffix such as `badexample.com` is rejected.
- Templates do not add random suffixes. Supply a stable session or branch value so `plan`, `ensure` and `remove` address the same name.

### TTL and proxy

On create, an unset TTL means automatic. On update, an unset TTL keeps the current value. Supported values are `auto` or 60–86400 seconds.

`proxied` is a Cloudflare extension. It is only changed when you set it; proxied records require automatic TTL, and TXT records reject the option. An explicit `false` is preserved.

## Cloudflare access

Create a **Custom token** at <https://dash.cloudflare.com/profile/api-tokens> with:

| Permission | Purpose |
| --- | --- |
| Zone · DNS · Edit | Read, create, update and delete records in the zone |
| Zone · Zone · Read | Resolve the zone by name, or validate a fixed zone ID |

Scope the token to the zones you manage and set an expiry. A fixed `zoneId` is still read and validated, so Zone Read is required either way. The dashboard may label `Edit` as `Write`; they mean the same thing.

## Output and exit codes

`--json` writes one NDJSON object per line to stdout and disables prompts and spinners:

```json
{ "event": "ensure", "requestId": "...", "data": { "action": "created", "record": { "id": "..." }, "ref": { "recordId": "..." } } }
```

Events are `init`, `plan`, `ensure`, `list`, `remove`, `doctor`, `error`, `help` and `version`. A conflict plan still includes the full plan and exits with code `3`.

Without `--json`, results are printed as structured JSON text and a spinner runs on stderr in a TTY. `--silent` suppresses human output; `--json` output is still produced. `--verbose` adds configuration field sources to `plan` and `ensure` results.

| Exit code | Meaning |
| --- | --- |
| `0` | Success, including `noop` and `already-absent` |
| `1` | Uncategorized internal or provider error |
| `2` | Config, naming or argument error |
| `3` | Conflict, ownership mismatch, ambiguous target or stale plan |
| `4` | Authentication or permission error |
| `5` | Unsupported capability or incompatible adapter |
| `6` | Zone or record lookup failure |
| `7` | Rate limit or timeout budget exhausted |
| `130` | Cancelled |

## SDK

Install the core and the adapter; no CLI or terminal UI is pulled in.

```bash
pnpm add @flash-dns/core @flash-dns/adapter-cloudflare
```

```ts
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
import { createDnsManager } from '@flash-dns/core'

const dns = createDnsManager({
  adapter: createCloudflareAdapter({ apiToken, zoneId })
})

const { ref } = await dns.ensure({
  zone: 'example.com',
  name: 'preview.example.com',
  type: 'CNAME',
  content: 'target.example.com',
  owner: { application: 'flash-tunnel', id: sessionId },
  providerOptions: { proxied: true }
}, { signal })

// ref is JSON-serializable and contains no credentials.
// Persist it with your own session state and remove it later.
await dns.remove(ref, { signal })
```

- `ensure` returns `{ action, record, ref }`.
- `remove` returns `{ action: 'removed' | 'already-absent' }`.
- `plan` returns `{ operation, zone, desired, existing?, conflict? }`.
- Errors are `DnsError` instances from `@flash-dns/types`, with `code`, `hint`, `retriable` and optional `details`.
- Pass `{ signal, requestId, logger }` as the operation context.
- The core never logs to the console and never exits the process.
- `@flash-dns/core` also exports `loadDnsConfig`, `resolveDnsConfig` and `desiredFromConfig` for tools that want the project rules. A full explicit hostname bypasses discovery entirely.

## Packages

All public packages ship ESM and type declarations; the root workspace package is private.

| Package | Role |
| --- | --- |
| `flash-dns` | CLI binary and the user-facing `defineConfig` entry |
| `@flash-dns/cli` | Command parsing, interaction and output |
| `@flash-dns/core` | Naming, configuration, reconciliation and ownership |
| `@flash-dns/config` | `defineConfig` and config types |
| `@flash-dns/types` | Adapter contract, record types and errors |
| `@flash-dns/adapter-cloudflare` | Cloudflare implementation |

## Ownership, conflicts and concurrency

On Cloudflare, ownership lives in the record comment as `flash-dns:v1:<base64url([application,id])>`, capped at 500 characters. Updates use `PATCH`, so user-written comment text, tags and settings survive. A comment is only treated as ownership when it contains exactly one valid marker line.

Ownership is bookkeeping, not authorization. Access is controlled by the API token.

| Situation | Result |
| --- | --- |
| No matching record | `create` |
| Same owner, same values | `noop`, record ID preserved |
| Same owner, different values | `update` in place |
| More than one owned record at the name | `AMBIGUOUS_RECORD`; pass a record ID |
| Existing record without an owner | `RECORD_CONFLICT`; automatic adoption is disabled |
| Same name, different owner | `OWNERSHIP_MISMATCH` |
| CNAME shares the name with another type | `RECORD_CONFLICT`; no automatic migration |
| Adapter cannot express the request | `CAPABILITY_UNSUPPORTED` |

`ensure` manages one record. Same-owner A / AAAA / TXT values can coexist at a name, but when more than one owned record matches, pass a record ID. `ensure` never deletes other records at the same name.

Deletion takes a ref (provider, zone ID, record ID, owner, optional snapshot), re-reads the record, and verifies both owner and snapshot. If either changed, deletion is refused. A record that is already gone is reported as `already-absent`.

Within one manager, writes are serialized. Cross-process coordination is the caller's responsibility — DNS APIs have no compare-and-swap. Reads retry with capped backoff and honor `Retry-After`; writes are not blindly retried. If a retriable write response is lost, the SDK re-reads the record before reporting failure.

Success means the provider API matches the requested record. It does not mean DNS caches are flushed, a tunnel is online, or HTTPS is ready.

## Security

- The CLI reads `CLOUDFLARE_API_TOKEN` from the environment only. It is never accepted as a flag or config field, and it is redacted from output.
- Use a zone-scoped token with an expiry. Grant Zone DNS Edit, plus Zone Read when resolving by name.
- Nothing is deleted on exit, `Ctrl+C` or `SIGTERM`; removal is always an explicit command or SDK call.
- There is no global overwrite switch. Unmanaged and foreign-owned records are refused rather than replaced.
- The config file is trusted JavaScript/TypeScript and is executed at load time.
- The SDK accepts the token as a constructor argument, so credential storage stays the caller's decision.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `AUTH_INVALID` or HTTP `401` | Set a valid `CLOUDFLARE_API_TOKEN` in the same shell that runs the command |
| `PERMISSION_DENIED` or HTTP `403` | Grant Zone DNS Edit; add Zone Read when the zone is resolved by name |
| `ZONE_NOT_FOUND` / `ZONE_NOT_ACTIVE` | Check the zone name or ID, and confirm the domain is active in Cloudflare |
| `RECORD_CONFLICT` | The name has an unmanaged record. Choose another hostname or resolve it manually; there is no overwrite switch |
| `OWNERSHIP_MISMATCH` | The record belongs to another owner. Use that owner's application and ID, or a different hostname |
| `AMBIGUOUS_RECORD` | Several owned records match; add `--record-id` |
| `PLAN_STALE` | DNS changed between planning and writing, or after selection. Run `plan` again |
| `CAPABILITY_UNSUPPORTED` | For example TXT with `proxied`, a manual TTL with `proxied`, or a TTL outside 60–86400 |
| `RATE_LIMITED` / `REQUEST_TIMEOUT` | Retry later. Reads retry automatically; writes should be retried with `ensure` |
| Config or naming error (exit `2`) | Run `plan --verbose` to confirm which source each field came from |
| `remove` refuses in CI | Add `--yes` and select the record with `--record-id` or a unique hostname |
| Wildcard certificate issue | `*.` records are allowed, but certificates are not managed here; [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/) may not cover deep names |

## Development

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pack
```

`pnpm check` runs build, lint, typecheck, tests and pack smoke in one go. `pnpm stub` creates development entry points for cross-package work. Requires Node `>= 22.14` and pnpm `12.15.0`; both are declared in `package.json`.

Tests use an in-memory Cloudflare fixture: no credentials, no real DNS calls. `test:pack` installs the local tarballs into a temporary directory and may download runtime dependencies from the registry, but it never touches the DNS API.

Issues and pull requests are welcome. Run `pnpm check` before opening one.

## Release

Pushing a `v*` tag is the only release trigger. The workflow first verifies build, lint, typecheck, tests and pack smoke on Windows and Linux with Node 22.14 and 24. It then publishes the public workspace packages from Ubuntu using npm trusted publishing (OIDC); no `NPM_TOKEN` is used.

Keep every package version in sync with the tag — for example `v0.1.1` needs version `0.1.1` — and configure the npm Trusted Publisher for each package with the `flash-tunnel/flash-dns` repository and the `release.yaml` workflow name.

## Design docs

The full design is in [ai-docs/design-docs](https://github.com/flash-tunnel/flash-dns/tree/main/ai-docs/design-docs) (Chinese).

## License

[MIT](https://github.com/flash-tunnel/flash-dns/blob/main/LICENSE)
