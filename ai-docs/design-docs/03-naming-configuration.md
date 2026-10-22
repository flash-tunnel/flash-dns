# 03 · 命名规则与配置

## 项目名来源（建议）

优先级：显式参数或 SDK 输入 > 环境变量 > 配置中的 project.name > package.json 的 name > 当前目录名。

自动读取 package.json 时使用 JSON.parse，记录使用了哪个文件；遇到存在但无法解析的文件明确报错，不静默改用另一个项目名。

项目名称用于生成标签；资源归属使用独立的稳定 ID。两者不能混用。

## 默认标准化（已确认）

1. 去掉 `@`。
2. 将 `/` 替换为 `-`。
3. 统一为小写。
4. 校验生成的 DNS 标签。

| 输入 | 输出 |
| --- | --- |
| @org-name/project-name | org-name-project-name |
| @org/project | org-project |
| project-name | project-name |
| @Org/Project | org-project |

默认不把其他非法字符静默转成横杠，不截断过长名称。需要不同处理时提供显式名称或自定义规则，避免隐式转换产生无法解释的冲突。

单个项目标签只允许 `[a-z0-9-]`，首尾为字母或数字，长度 1–63。完整 hostname 校验各标签和总长度，允许以 `*.` 开头的显式通配记录；变量值不能注入通配符或额外层级。

首版聚焦 ASCII 域名；不隐式执行 Unicode 转写。显式 punycode 域名按 ASCII 标签校验。

## 模板（建议）

```text
{project}.slidev.acewill.dev
{project}-{branch}.preview.acewill.dev
{project}-{session}.preview.acewill.dev
{project}.{namespace}.acewill.dev
```

- 内建变量：project、branch、session。
- 自定义变量通过 `variables` 显式传入，例如 namespace。
- 不执行模板内的 JavaScript，不读取任意环境变量。
- 未知变量、缺失变量、非法标签直接报错。
- branch 只有使用到时才探测；SDK 可以完全不依赖 Git。
- 显式 hostname 优先于模板，但仍执行 hostname 和 Zone 校验。
- 第一版不内建随机后缀。临时会话 ID 由调用方生成并传入，保证 plan、ensure 和清理使用同一名称。

扩展点预留纯函数命名器：SDK 可传入自定义命名函数；TS 配置也可提供同类纯函数。函数输出仍经过同样的校验。首版优先实现模板，不将函数结果与配置优先级混成两套逻辑。

## Zone 与 hostname

```text
Zone：acewill.dev
Hostname：org-name-project-name.slidev.acewill.dev
```

不能因为 hostname 存在 `slidev` 就自动查找 `slidev.acewill.dev` Zone。Zone 和命名空间是两个概念。

校验 hostname 属于指定 Zone 时使用标签边界：允许 Zone 本身或以 `.${zone}` 结尾；不接受仅字符串后缀相同的伪域名。

## 配置示例（拟议 API）

```ts
import { defineConfig } from 'flash-dns'

export default defineConfig({
  provider: 'cloudflare',
  zone: 'acewill.dev',

  project: {
    name: '@org-name/project-name',
    id: 'gitlab:acewill/slides/project-name'
  },

  naming: {
    template: '{project}.slidev.acewill.dev'
  },

  record: {
    type: 'CNAME',
    content: '<tunnel-id>.cfargotunnel.com',
    ttl: 'auto'
  },

  providers: {
    cloudflare: {
      zoneId: '<zone-id>',
      proxied: true
    }
  }
})
```

配置不提供 API Token 字段。`<...>` 是示意占位值，真实命令执行前必须补齐。CNAME 目标由外部系统提供，flash-dns 不创建对应 Tunnel。

## 加载与优先级

- 默认文件建议采用 `flash-dns.config.ts`，支持 `--config`。
- 优先级：CLI > 环境变量 > 配置文件 > 自动探测及默认值。
- false、0 等值不按“空值”处理；字段是否合法交由运行时校验。
- 相对路径以配置文件目录为基准，CLI 显式工作目录按 cwd 解析。
- 自动查找向上到 Git 根目录或文件系统根目录为止；显式配置路径不受自动查找规则影响。
- 使用 unconfig，错误中带配置位置和字段路径；`plan` 可显示非敏感字段来源。
- 配置文件是可信 TS 代码，不宣称能安全执行不可信配置。
- npx 临时安装场景必须验证 `import { defineConfig } from 'flash-dns'` 可解析，借鉴 flash-tunnel 的加载期处理并增加独立 fixture。

拟议环境变量包含 `FLASH_DNS_ZONE`、`FLASH_DNS_HOSTNAME`、`FLASH_DNS_PROJECT`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ZONE_ID`。具体映射在实现配置模块时统一列出，不能让 provider 自行覆盖已解析的值。

## 同名冲突

`@org/name` 和 `org-name` 会映射到相同标签，这是允许出现的输入，但不能据此认为它们是同一项目。

稳定 project.id 或 owner 用于判断记录归属。名称相同、owner 不同则报冲突，要求调用方指定另一个名称；不自动追加后缀，也不通过全局“工具创建”前缀获得覆盖权。
