# flash-dns

**按项目身份管理 DNS 记录，为自动化部署而生。**

flash-dns 把项目身份和命名规则变成一条 DNS 记录：将 `@org-name/project-name` 标准化为 `org-name-project-name`，按模板生成 `org-name-project-name.preview.example.com` 这样的主机名，再通过服务商适配器协调 A / AAAA / CNAME / TXT 记录。可以在终端里使用 CLI，也可以把 SDK 嵌入部署工具。它只管理权威 DNS 记录，不是解析器、隧道管理器或部署系统。

[English](https://github.com/flash-tunnel/flash-dns/blob/main/README.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/flash-dns?style=flat-square&color=blue)](https://www.npmjs.com/package/flash-dns)
[![npm downloads](https://img.shields.io/npm/dm/flash-dns?style=flat-square)](https://www.npmjs.com/package/flash-dns)
[![license](https://img.shields.io/npm/l/flash-dns?style=flat-square)](https://github.com/flash-tunnel/flash-dns/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/flash-dns?style=flat-square)](https://www.npmjs.com/package/flash-dns)

> 早期预览版（`0.1.x`）。核心与具体服务商解耦，但目前只有 Cloudflare 适配器。正式使用前先用 `plan` 检查变更。

## 为什么用它

- **一套命名规则，处处一致** — `{project}`、`{branch}`、`{session}` 和自定义变量把项目身份变成可复现的主机名。
- **不碰不该碰的记录** — 记录带版本化的归属标记；不接管无主记录，不修改其他 owner 的记录，删除只按精确 ID 并核对快照。
- **幂等** — `plan` 只读展示 `create` / `update` / `noop` / `conflict`；相同输入再次 `ensure` 不会重复创建，记录 ID 保持不变。
- **原位更新** — 用 `PATCH` 只改明确要求的字段，保留用户备注、tags 以及未指定的 TTL、代理设置。
- **面向自动化** — NDJSON 输出、稳定退出码，SDK 的每次调用都支持 `AbortSignal`。
- **边界清晰** — 只做 DNS：不创建隧道、不启动应用、不申请证书，退出时也不会自动删除记录。

## 工作流程

1. 按 CLI 参数、环境变量、配置文件的顺序加载配置。
2. 标准化项目名，按模板生成主机名（或使用显式主机名），校验标签和 Zone 边界。
3. 解析 Cloudflare Zone，读取该主机名下已有的记录。
4. 根据归属和记录内容，判定为 `create`、`update`、`noop` 或 `conflict`。
5. 执行 `ensure` 时重新复查，按 ID 创建或更新，再读回记录校验，并返回可序列化的 `ref` 供后续删除。

## 环境要求

- Node.js **>= 22.14**
- 一个 Cloudflare 账号、一个已激活的 Zone，以及有该 Zone DNS 权限的 API Token
- 不需要 `cloudflared` 或其他外部程序

## 安装

```bash
# 直接运行，无需安装
npx flash-dns --help

# 全局安装 CLI
npm install -g flash-dns

# 作为项目依赖固定版本（CI 推荐）
pnpm add -D flash-dns
```

使用 SDK 时安装 core 和对应适配器：

```bash
pnpm add @flash-dns/core @flash-dns/adapter-cloudflare
```

## 快速开始

```bash
# macOS / Linux
export CLOUDFLARE_API_TOKEN=your_token_here

# Windows PowerShell
$env:CLOUDFLARE_API_TOKEN = "your_token_here"
```

先生成带稳定项目身份的配置：

```bash
npx flash-dns init
```

然后填写 Zone、命名规则和记录目标：

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

这份配置管理的主机名是 `org-name-project-name.preview.example.com`。

```bash
npx flash-dns plan     # 只读：显示 create / update / noop / conflict
npx flash-dns ensure   # 把记录协调到期望状态
npx flash-dns doctor   # 检查 Token、Zone 和 DNS 读取能力
```

`init` 会生成并保留一个稳定的 `project.id`，不会覆盖已有文件。请保持这个 ID 不变，它代表记录的归属身份。`192.0.2.1` 是文档示例地址。

## 命令

| 命令 | 说明 |
| --- | --- |
| `flash-dns init` | 生成 `flash-dns.config.ts` 和稳定的 `project.id`；不覆盖已有文件 |
| `flash-dns plan` | 显示最终主机名、目标记录和 `create` / `update` / `noop` / `conflict`；不写 DNS |
| `flash-dns ensure` | 协调一条记录；写前复查，写后校验 |
| `flash-dns list` | 列出 Zone 内的记录，可按 `--name`、`--owner-id` 过滤 |
| `flash-dns remove` | 删除一条归属匹配的记录；记录已不存在时视为成功 |
| `flash-dns doctor` | 检查配置、Token、Zone 和 DNS 读取能力；不测试写权限 |

交互式 `remove` 会打印目标记录并要求确认；非交互运行必须提供 `--yes`。不带命令运行 `flash-dns` 会显示帮助并退出 `0`。

## 参数

参数优先于环境变量和配置。`flash-dns --help` 会列出内置帮助。

### 通用参数

| 参数 | 说明 |
| --- | --- |
| `--cwd <dir>` | 工作目录，也是配置查找的起点 |
| `--config <path>` | 指定配置文件，相对 `--cwd` 解析 |
| `--json` | 输出 NDJSON，并关闭交互提示和 spinner |
| `--silent` | 不输出人类可读内容 |
| `--verbose` | 在 `plan` / `ensure` 结果中附上字段来源 |
| `--no-color` | 关闭颜色 |
| `--yes` | 跳过确认（非交互 `remove` 必须提供） |
| `--help`、`--version` | 显示帮助或版本 |

### 选择与记录参数

| 参数 | 说明 |
| --- | --- |
| `--provider <name>` | 服务商 ID；目前只支持 `cloudflare` |
| `--zone <domain>` | Zone 名称，例如 `example.com` |
| `--zone-id <id>` | Cloudflare Zone ID；跳过按名称查找 |
| `--hostname <fqdn>` | 完整主机名；优先于模板 |
| `--project <name>` | `{project}` 使用的项目名 |
| `--project-id <id>` | 稳定的归属 ID |
| `--template <text>` | 命名模板 |
| `--branch <label>` | `{branch}` 的值；未提供时从 Git 读取 |
| `--session <label>` | `{session}` 的值 |
| `--type <type>` | `A`、`AAAA`、`CNAME` 或 `TXT` |
| `--content <text>` | 记录内容 |
| `--ttl <value>` | `auto` 或秒数 |
| `--proxied <value>` | `true` 或 `false`；仅 Cloudflare 代理 |
| `--record-id <id>` | 选择一条已有记录 |
| `--name <fqdn>` | `list` 的主机名过滤；`remove` 的选择条件 |
| `--owner-id <id>` | `list` 的归属 ID 过滤；`remove` 的归属选择条件 |
| `--owner-application <name>` | `list` / `remove` 的归属应用，默认 `flash-dns` |

## 配置

flash-dns 从工作目录开始查找 `flash-dns.config.{ts,mts,js,mjs,json}`，逐级向上，直到 Git 根目录或文件系统根目录。也可以用 `--config` 显式指定。

优先级：**CLI > 环境变量 > 配置文件 > 自动探测和默认值**。显式的 `false` 和 `0` 是有效值，不按“未设置”处理。

```ts
// flash-dns.config.ts
import { defineConfig } from 'flash-dns'

export default defineConfig({
  provider: 'cloudflare',
  zone: 'example.com',

  // hostname: 'preview.example.com', // 优先于 naming.template
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

- `provider` 默认为 `cloudflare`，目前没有其他服务商。
- `zone` 必填，且该 Zone 必须在 Cloudflare 中处于激活状态。
- `project.id` 是稳定的归属身份，`plan` 和 `ensure` 需要它；`remove` 也可以改用 `--owner-id`。
- `project.name` 用于填充 `{project}`。未填写时依次读取配置文件所在目录的 `package.json` `name` 和目录名。
- `naming.template` 默认为 `{project}` 加上 Zone 名称。
- `hostname` 跳过模板和变量，但仍会经过完整校验。
- `variables` 提供自定义模板变量。
- `plan` 和 `ensure` 需要 `record.type` 与 `record.content`。
- `record.ttl` 接受 `auto` 或秒数。
- `providers.cloudflare.zoneId` 可选；省略时按名称查找 Zone。
- `providers.cloudflare.proxied` 仅在显式设置时生效。

未知字段会直接报错。配置文件是可信代码，加载时会被执行，不要加载不可信的配置。

### 环境变量

| 变量 | 对应配置 |
| --- | --- |
| `FLASH_DNS_PROVIDER` | `provider` |
| `FLASH_DNS_ZONE` | `zone` |
| `FLASH_DNS_HOSTNAME` | `hostname` |
| `FLASH_DNS_PROJECT` | `project.name` |
| `FLASH_DNS_PROJECT_ID` | `project.id` |
| `FLASH_DNS_TEMPLATE` | `naming.template` |
| `FLASH_DNS_BRANCH` | `{branch}` 的值 |
| `FLASH_DNS_SESSION` | `{session}` 的值 |
| `FLASH_DNS_TYPE` | `record.type` |
| `FLASH_DNS_CONTENT` | `record.content` |
| `FLASH_DNS_TTL` | `record.ttl` |
| `FLASH_DNS_PROXIED` | `providers.cloudflare.proxied`；`true` 或 `false` |
| `CLOUDFLARE_ZONE_ID` | `providers.cloudflare.zoneId` |
| `CLOUDFLARE_API_TOKEN` | 适配器凭据；不会进入解析后的配置 |

### 命名规则

模板可以使用 `{project}`、`{branch}`、`{session}` 以及 `variables` 中的任意键。只有 `{project}` 会自动标准化。

| 输入 | 标签 |
| --- | --- |
| `@org-name/project-name` | `org-name-project-name` |
| `@Org/Project` | `org-project` |

不同的输入可能得到同一个标签，例如 `@org/name` 和 `org-name`。它们仍然是两个项目：归属始终由 `project.id` 决定，同名但 owner 不同会报冲突，而不是静默接管。

标签长度为 1–63 个字符，只能包含小写字母、数字和连字符，首尾必须是字母或数字。其他字符和超长标签会报错，不会静默替换或截断。

- 只有模板引用 `{branch}` 时才会执行 `git branch --show-current`；CI 中请传入 `--branch` 或 `FLASH_DNS_BRANCH`。
- 每个模板变量值都必须是单个合法标签。分支名 `feat/login` 需要传成 `feat-login`，工具不会自动替换斜杠。
- 显式主机名允许以 `*.` 开头；模板变量不能注入通配符或额外层级。
- 主机名必须等于 Zone，或以 `.${zone}` 结尾；`badexample.com` 这类仅字符串后缀相同的名字会被拒绝。
- 模板不会自动追加随机后缀。请传入稳定的 session 或 branch 值，确保 `plan`、`ensure` 和 `remove` 指向同一个名字。

### TTL 与代理

创建时未指定 TTL 表示自动；更新时未指定 TTL 会保留当前值。支持 `auto` 或 60–86400 秒。

`proxied` 是 Cloudflare 的扩展字段，仅在显式设置时修改。代理记录要求自动 TTL，TXT 记录不接受该选项；显式的 `false` 会被保留。

## Cloudflare 权限

在 <https://dash.cloudflare.com/profile/api-tokens> 创建 **Custom token**，添加：

| 权限 | 用途 |
| --- | --- |
| Zone · DNS · Edit | 读取、创建、更新和删除该 Zone 的记录 |
| Zone · Zone · Read | 按名称解析 Zone，或校验固定 Zone ID |

请把 Token 限制在实际管理的 Zone 上并设置过期时间。即使固定了 `zoneId`，工具仍会读取并校验 Zone，因此同样需要 Zone Read。Cloudflare 后台可能把 `Edit` 显示为 `Write`，含义相同。

## 输出与退出码

`--json` 会在 stdout 上每行输出一个 NDJSON 对象，并关闭交互提示和 spinner：

```json
{ "event": "ensure", "requestId": "...", "data": { "action": "created", "record": { "id": "..." }, "ref": { "recordId": "..." } } }
```

事件包括 `init`、`plan`、`ensure`、`list`、`remove`、`doctor`、`error`、`help` 和 `version`。冲突的 plan 仍会输出完整计划，并以退出码 `3` 结束。

不加 `--json` 时，结果以结构化 JSON 文本打印；TTY 下的 spinner 输出到 stderr。`--silent` 抑制人类可读输出，但 `--json` 仍会正常输出。`--verbose` 会在 `plan` / `ensure` 结果中附带配置字段来源。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功，包括 `noop` 和 `already-absent` |
| `1` | 未分类的内部或服务商错误 |
| `2` | 配置、命名或参数错误 |
| `3` | 冲突、归属不匹配、目标不唯一或计划过期 |
| `4` | 认证或权限错误 |
| `5` | 能力不支持或适配器不兼容 |
| `6` | Zone 或记录定位失败 |
| `7` | 限流或超时预算耗尽 |
| `130` | 已取消 |

## SDK

只安装 core 和适配器即可使用，不会引入 CLI 或终端 UI。

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

// ref 可 JSON 序列化，且不包含凭据。
// 可以写入调用方自己的会话状态，稍后再删除。
await dns.remove(ref, { signal })
```

- `ensure` 返回 `{ action, record, ref }`。
- `remove` 返回 `{ action: 'removed' | 'already-absent' }`。
- `plan` 返回 `{ operation, zone, desired, existing?, conflict? }`。
- 异常是 `@flash-dns/types` 的 `DnsError`，包含 `code`、`hint`、`retriable` 和可选的 `details`。
- 操作上下文支持 `{ signal, requestId, logger }`。
- core 不向控制台打印日志，也不会终止进程。
- 需要项目命名规则时，`@flash-dns/core` 还导出 `loadDnsConfig`、`resolveDnsConfig` 和 `desiredFromConfig`；传入完整 hostname 可以完全绕过配置发现。

## 包结构

所有公开包都输出 ESM 和类型声明；根 workspace 包为 private。

| 包 | 职责 |
| --- | --- |
| `flash-dns` | CLI 入口和面向用户的 `defineConfig` 导出 |
| `@flash-dns/cli` | 命令解析、交互和输出 |
| `@flash-dns/core` | 命名、配置、协调和归属 |
| `@flash-dns/config` | `defineConfig` 和配置类型 |
| `@flash-dns/types` | 适配器契约、记录类型和错误 |
| `@flash-dns/adapter-cloudflare` | Cloudflare 实现 |

## 归属、冲突与并发

在 Cloudflare 上，归属信息保存在记录 comment 中，格式为 `flash-dns:v1:<base64url([application,id])>`，最长 500 字符。更新使用 `PATCH`，因此用户写的备注、tags 和设置都会保留。只有 comment 中恰好存在一条合法标记时，记录才被视为有归属。

归属标记只是记账信息，不是访问授权；真正的权限由 API Token 控制。

| 当前状态 | 结果 |
| --- | --- |
| 没有匹配的记录 | `create` |
| 同一 owner，内容一致 | `noop`，保留记录 ID |
| 同一 owner，内容变化 | 原位 `update` |
| 同一名称下有多条本 owner 的记录 | `AMBIGUOUS_RECORD`，需要指定记录 ID |
| 已有记录没有归属 | `RECORD_CONFLICT`，不会自动接管 |
| 名称相同但 owner 不同 | `OWNERSHIP_MISMATCH` |
| CNAME 与其他类型共用同一名称 | `RECORD_CONFLICT`，不会自动迁移类型 |
| 适配器无法表达请求 | `CAPABILITY_UNSUPPORTED` |

`ensure` 只管理一条记录。同 owner 的 A / AAAA / TXT 多值可以共存，但匹配到多条本 owner 记录时需要指定记录 ID。`ensure` 不会删除同名的其他记录。

删除使用 ref（provider、zoneId、recordId、owner 和可选快照），会重新读取记录并核对归属与快照；任何一项变化都会拒绝删除。记录已经不存在时返回 `already-absent`。

同一个 manager 内的写操作会串行执行；跨进程协调由调用方负责，因为 DNS API 没有 compare-and-swap。读取请求会做有上限的退避重试并遵守 `Retry-After`，写请求不会盲目重发；如果可重试的写响应丢失，SDK 会先重新读取记录再决定是否报错。

成功只表示服务商 API 中的记录与期望一致，不代表 DNS 缓存已刷新、隧道在线或 HTTPS 已就绪。

## 安全

- CLI 只从环境变量 `CLOUDFLARE_API_TOKEN` 读取凭据，不接受命令行参数或配置字段，并会在输出中脱敏。
- 使用限定 Zone、设置过期时间的 Token；按名称解析时还需要 Zone Read。
- 退出、`Ctrl+C` 或 `SIGTERM` 都不会删除记录；删除只能通过显式命令或 SDK 调用。
- 没有全局覆盖开关。无主记录和其他 owner 的记录会被拒绝，而不是被替换。
- 配置文件是可信的 JavaScript/TypeScript，加载时会被执行。
- SDK 通过构造参数接收 Token，凭据如何保存由调用方决定。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `AUTH_INVALID` 或 HTTP `401` | 在运行命令的同一个 shell 中设置有效的 `CLOUDFLARE_API_TOKEN` |
| `PERMISSION_DENIED` 或 HTTP `403` | 授予 Zone DNS Edit；按名称解析时再补 Zone Read |
| `ZONE_NOT_FOUND` / `ZONE_NOT_ACTIVE` | 检查 Zone 名称或 ID，并确认域名已在 Cloudflare 激活 |
| `RECORD_CONFLICT` | 该名称已有无主记录。换一个主机名，或手动处理；没有覆盖开关 |
| `OWNERSHIP_MISMATCH` | 记录属于其他 owner。使用对应的 application 和 ID，或换一个主机名 |
| `AMBIGUOUS_RECORD` | 匹配到多条本 owner 记录；用 `--record-id` 指定 |
| `PLAN_STALE` | 计划与写入之间（或选择之后）DNS 状态变化；重新执行 `plan` |
| `CAPABILITY_UNSUPPORTED` | 例如 TXT 配 `proxied`、代理记录配手动指定的 TTL，或 TTL 超出 60–86400 |
| `RATE_LIMITED` / `REQUEST_TIMEOUT` | 稍后重试。读取会自动重试；写入请重新执行 `ensure` |
| 配置或命名错误（退出码 `2`） | 运行 `plan --verbose` 确认每个字段来自哪个来源 |
| CI 中 `remove` 被拒绝 | 加 `--yes`，并用 `--record-id` 或唯一主机名选择目标 |
| 通配符证书问题 | 允许 `*.` 记录，但证书不由本工具管理；[Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/) 可能不覆盖较深层级的域名 |

## 开发

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pack
```

`pnpm check` 会依次执行 build、lint、typecheck、测试和 pack smoke。`pnpm stub` 为跨包开发生成开发入口。需要 Node `>= 22.14` 和 pnpm `12.15.0`（见 `package.json`）。

测试使用内存中的 Cloudflare fixture，不需要凭据，也不会访问真实 DNS。`test:pack` 会把本地 tarball 安装到临时目录，可能从 registry 下载运行时依赖，但不会调用 DNS API。

欢迎提交 Issue 和 PR；提交前请先运行 `pnpm check`。

## 发布

推送 `v*` tag 是唯一的发布触发条件。workflow 会先在 Windows / Linux 和 Node 22.14 / 24 上执行 build、lint、typecheck、测试和 pack smoke，然后在 Ubuntu 上通过 npm Trusted Publisher（OIDC）发布 workspace 中的公开包，不使用 `NPM_TOKEN`。

请让所有包的版本与 tag 保持一致，例如 `v0.1.1` 对应版本 `0.1.1`；并在 npm 后台为每个包绑定 `flash-tunnel/flash-dns` 仓库和 `release.yaml` workflow。

## 设计文档

完整设计见 [ai-docs/design-docs](https://github.com/flash-tunnel/flash-dns/tree/main/ai-docs/design-docs)。

## License

[MIT](https://github.com/flash-tunnel/flash-dns/blob/main/LICENSE)
