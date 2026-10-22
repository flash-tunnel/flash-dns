# flash-dns

根据项目名称和命名规则管理 DNS 记录，同时提供 CLI 和 SDK。首版支持 Cloudflare 的 A、AAAA、CNAME、TXT；Tunnel、应用部署和证书由调用方管理。

需要 Node.js >=22.14。当前版本为 0.1.0，尚未发布到 npm。

## 本地开发

```sh
pnpm install --frozen-lockfile
pnpm run build
node packages/flash-dns/bin/flash-dns.mjs --help
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:pack
```

也可用 `pnpm run stub` 生成开发入口。`test:pack` 会安装本地产物到临时目录，可能从 registry 下载运行依赖，不会访问 DNS API。CI 配置覆盖 Windows / Linux 和 Node 22.14 / 24；本地验证结果见 [开发报告](ai-docs/implementation-report.md)。

## CLI

```sh
flash-dns init
```

将生成配置中的示例 Zone、模板和记录内容改成实际值。`init` 生成并持久保存稳定的 `project.id`，不会覆盖已有目标文件。

```ts
import { defineConfig } from 'flash-dns'

export default defineConfig({
  provider: 'cloudflare',
  zone: 'acewill.dev',
  project: {
    name: '@org-name/project-name',
    id: 'gitlab:acewill/slides/project-name'
  },
  naming: { template: '{project}.slidev.acewill.dev' },
  record: { type: 'A', content: '192.0.2.1', ttl: 'auto' },
  providers: { cloudflare: { zoneId: 'your-zone-id', proxied: false } }
})
```

上述命名得到 `org-name-project-name.slidev.acewill.dev`。`192.0.2.1` 是文档示例地址。

凭据只通过环境变量 `CLOUDFLARE_API_TOKEN` 提供，不接受 token 命令行参数或配置字段。令牌按目标 Zone 分配 DNS 读取/编辑权限；通过名称发现 Zone 时还需相应 Zone 读取权限。固定 Zone ID 时仍会读取并校验 Zone 名称和状态。

```sh
flash-dns plan
flash-dns ensure --json
flash-dns list --name org-name-project-name.slidev.acewill.dev
flash-dns doctor
flash-dns remove --record-id RECORD_ID --yes
```

`remove` 需要配置中的 `project.id` 或显式 `--owner-id`，通过名称选择时要求唯一目标。默认 owner application 为 `flash-dns`，可通过 `--owner-application` 选择 SDK 创建的记录。交互删除显示目标并确认；CI、JSON 和非 TTY 模式要求 `--yes`。退出进程不触发删除。

`plan` 查询当前状态并显示 create / update / noop / conflict，不写 DNS。`ensure` 会重新规划、在执行前复查，并读取服务商状态确认结果。`doctor` 只检查真实读取能力，不测试写权限。无命令时显示帮助。

`--json` 输出 NDJSON，一次命令输出一个包含 `event`、`requestId`、`data` 的结果或错误对象；冲突的 plan 也保留完整计划并返回非零退出码。`--silent` 抑制人类输出，JSON 结果仍保留。`--verbose` 在 plan/ensure 结果中附上字段来源。默认人类输出为结构化 JSON 文本，TTY 操作期间显示 spinner，不使用彩色结果文本。

退出码：0 成功，1 服务商/内部错误，2 配置/参数，3 冲突/归属/过期状态，4 认证/权限，5 能力/适配器，6 Zone/记录定位，7 超时/限流耗尽，130 取消。

## 配置与命名

默认发现 `flash-dns.config.ts`，也支持 mts、js、mjs、json；向上查找到 Git 根或文件系统根为止。`--config` 按 `--cwd` 解析显式路径。项目 package.json 发现以配置文件所在目录为基准；SDK 可直接传完整 hostname，完全绕过发现过程。

优先级为 CLI > 环境变量 > 文件 > 默认/自动发现。未填写 TTL 时，创建使用自动 TTL，更新保留现有值。代理开关仅在显式指定时修改。配置是可信代码，会在加载时执行。

| 环境变量 | 对应值 |
| --- | --- |
| FLASH_DNS_PROVIDER | provider |
| FLASH_DNS_ZONE | zone |
| FLASH_DNS_HOSTNAME | hostname |
| FLASH_DNS_PROJECT | project.name |
| FLASH_DNS_PROJECT_ID | project.id |
| FLASH_DNS_TEMPLATE | naming.template |
| FLASH_DNS_BRANCH / FLASH_DNS_SESSION | 模板变量 |
| FLASH_DNS_TYPE / FLASH_DNS_CONTENT / FLASH_DNS_TTL | 记录类型、内容、TTL |
| FLASH_DNS_PROXIED | true 或 false |
| CLOUDFLARE_ZONE_ID | providers.cloudflare.zoneId |
| CLOUDFLARE_API_TOKEN | 适配器凭据，不进入配置结果 |

`--hostname` 优先于模板。变量包括 project、branch、session 和 `variables` 中的自定义字段；仅在模板引用 branch 时尝试读取 Git 分支。变量必须是单个合法 ASCII DNS 标签；分支名中的 `/` 不会被自动替换。显式 hostname 支持 `*.` 前缀，所有 hostname 均检查 Zone 标签边界。

scoped 项目名去掉前导 `@`、把 `/` 改成 `-` 并转小写。其余非法字符和超过 63 字符的标签会报错，不会自动截断。不同原名可以映射到同名，资源归属始终依赖独立的 owner。

## SDK

只依赖 `@flash-dns/core` 和 `@flash-dns/adapter-cloudflare` 即可使用，不引入 CLI、spinner 或交互依赖。

```ts
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
import { createDnsManager } from '@flash-dns/core'

const dns = createDnsManager({
  adapter: createCloudflareAdapter({ apiToken, zoneId })
})

const result = await dns.ensure({
  zone: 'example.com',
  name: 'preview.example.com',
  type: 'CNAME',
  content: `${tunnelId}.cfargotunnel.com`,
  owner: { application: 'flash-tunnel', id: sessionId },
  providerOptions: { proxied: true }
}, { signal })

// ref 可序列化到调用方会话状态；由调用方决定何时清理。
await dns.remove(result.ref, { signal })
```

示例变量由调用方提供。`ensure` 返回 action、实际 record 和 ref；`remove` 返回 removed 或 already-absent。异常为 `@flash-dns/types` 的 `DnsError`，包含稳定 code、hint、retriable 和可选 details。core 不打印日志或终止进程。

## 归属、并发与服务商限制

Cloudflare comment 使用 `flash-dns:v1:` 加上 base64url 编码的 `[application,id]`，保守限制为 500 字符。更新使用 PATCH，保留用户备注、tags、settings 和未指定选项。无 owner、其他 owner 或旧 `flash-tunnel:` 标记不会被自动接管。元数据用于防止误操作，访问授权仍由 API Token 决定。

同 owner 的明确记录可与同名多值 A / AAAA / TXT 共存；如果没有归属匹配目标，已有同类型记录导致冲突。同 owner 多条记录要求 `recordId`。CNAME 跨类型共存直接报冲突，不通过删除旧记录迁移类型。

同一 manager 串行执行写操作；跨进程仍需要调用方的部署锁。执行前读取无法消除 API 不提供 compare-and-swap 导致的外部竞态。GET 请求对网络、5xx、429 有限退避，遵守 Retry-After；超过默认 10 秒单次等待上限时返回错误。写请求不盲目重发，失败后由协调层查询已提交状态；未确认成功时返回错误，由调用方后续重新 ensure。

Cloudflare TTL 范围保守采用自动或 60–86400 秒；本版不开放 Enterprise 的更低 TTL。proxied 记录要求自动 TTL，TXT 不接受 proxied 选项。完成表示服务商 API 状态符合预期，不代表缓存刷新、Tunnel 在线、证书或应用就绪。

API 行为依据 [Cloudflare DNS Records API](https://developers.cloudflare.com/api/resources/dns/subresources/records/)。深层域名的证书覆盖由调用方另行安排，参见 [Universal SSL 限制](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)。

## 工程与发布

六个包为 types、config、core、adapter-cloudflare、cli、flash-dns。公共包输出 ESM 和类型声明，根包 private。工程采用 pnpm、antfu ESLint、nano-staged、simple-git-hooks、严格 TypeScript、unbuild 和 Vitest。

发布流程沿用 flash-tunnel 的 `.github/workflows/release.yaml`，唯一触发条件是推送 `v*` tag。普通分支 push、PR 和手动调度均不触发。流程先在 Windows / Linux、Node 22.14 / 24 验证构建、lint、类型、测试及打包，再通过 OIDC 发布 workspace 中的公开包，跳过 private 根包。

发布前需要在各 npm 包的 Trusted Publisher 设置中绑定 GitHub 组织 `flash-tunnel`、仓库 `flash-dns` 和 workflow 文件名 `release.yaml`，并核对包的发布权限。流水线不依赖 NPM_TOKEN；配置文件不能代替 npm 后台绑定。各包版本需与发布 tag 一致，例如 0.1.0 对应 `v0.1.0`。普通安装、构建和测试不会操作真实 DNS。

MIT License。
