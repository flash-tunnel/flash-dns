# 08 · 工程规范与发布检查

## 参考基线

以 `D:\Projects\flash-tunnel` 的实际文件为依据：根 package.json、eslint.config.ts、tsconfig.json、pnpm-workspace.yaml、scripts/build.common.ts 和发布 workflow。

调研时该项目使用 pnpm 12.14.0、ESLint 10、antfu config 9、TypeScript 6、unbuild 3、Vitest 5、simple-git-hooks 2、nano-staged 1、bumpp 12。它们是本地参考版本，不代表已验证适用于新项目；初始化时固定并验证兼容组合。

本项目实际固定 pnpm 12.14.0、ESLint 10.13.0、antfu config 9.5.1、TypeScript 5.9.3、unbuild 3.6.1、Vitest 5.0.5。TypeScript 采用 5.9.3 以符合 unbuild 的 peer 范围。配置通过 unconfig + jiti alias 加载，不改写用户配置文本，也不在配置目录写临时转换文件。发布 CI 使用下述 `release.yaml`；尚未增加 bumpp。

## 开发约定

- ESM，`type: module`。
- pnpm workspace，内部依赖 `workspace:*`，根包 private。
- 严格 TypeScript：strict、noUncheckedIndexedAccess、verbatimModuleSyntax、isolatedModules、noEmit。
- 参考 ESNext / Bundler 模块解析；运行时最低版本和构建 target 保持一致，基线参考 Node >=22.14 和 node22 target，最终结合依赖验证。
- 文件与目录 kebab-case，变量与函数 camelCase，类型 PascalCase。
- 使用 import type；错误抛 Error 子类，附稳定 code/hint，不抛字符串。
- 中文设计文档，英文代码标识符；注释解释原因和公共 API 的幂等、错误语义。
- 副作用放在显式调用内，core 不 console.log，不读取终端或主动退出进程。

## ESLint

```ts
import { antfu } from '@antfu/eslint-config'

export default antfu({
  type: 'lib',

  rules: {
    'style/comma-dangle': ['warn', 'never']
  },

  ignores: [
    '**/dist/**',
    '**/coverage/**',
    'ai-docs/**'
  ]
})
```

遵循 antfu 的两空格、单引号、不写分号等默认风格，无尾逗号规则与现有项目一致。不引入第二套相互冲突的格式化工具。

## Git hooks

```json
{
  "scripts": {
    "prepare": "simple-git-hooks",
    "lint": "eslint --cache",
    "lint:fix": "eslint --cache --fix"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm nano-staged"
  },
  "nano-staged": {
    "*.{ts,js,mjs,cjs,json,jsonc,md,yml,yaml}": "eslint --cache --fix"
  }
}
```

- pre-commit 只修复暂存文件，不运行全量 typecheck、测试或构建。
- pnpm 安装策略显式允许确有需要的构建脚本，例如 esbuild 和 simple-git-hooks；沿用参考仓库写法并验证安装行为。
- Conventional Commits；bumpp 管理多包版本时维持统一版本策略。
- `.editorconfig`：UTF-8、LF、两空格、末尾换行；Markdown 保留有意义的尾随空格。
- `.gitignore` 排除 node_modules、dist、coverage、eslint cache、日志和凭据；`.env.example` 仅含占位值。

## 构建与开发

- unbuild，共享配置放 scripts/build.common.ts，沿用 defu 合并。
- 输出 ESM、类型声明，声明保留外部依赖引用，不默认内联所有依赖。
- `pnpm stub` 使用 `unbuild --stub`，支持跨包开发。
- 每包提供 build / stub / typecheck；根包递归执行。
- 根 tsconfig 和 Vitest 的源码路径映射保持一致。
- bin 薄包装，包含 shebang、runCli 调用和最后的错误处理。
- `bin`、`exports`、`main`、`types`、`files` 与实际构建产物一致。

## 验证与 CI

```text
install --frozen-lockfile → build → lint → typecheck → test → pack smoke
```

先 build，避免干净工作区下包类型入口还不存在。测试 core 和配置加载覆盖 Windows、Linux；需要 rsync/SSH 的部署测试不属于本项目。

CLI 项目的版本验证和发包流程与演示站点部署流程独立。按用户要求参考 flash-tunnel，唯一 workflow 为 `.github/workflows/release.yaml`，唯一触发条件为 `push.tags: ['v*']`。不再保留分支 push、pull_request、workflow_dispatch 等其他触发方式。

`verify` 使用 Windows / Linux 和 Node 22.14 / 24 矩阵，执行 build、lint、typecheck、test、pack smoke；全部成功后 `publish` 在 Ubuntu、Node 24 上重新构建并执行 `pnpm -r publish --access public --no-git-checks`。pnpm 版本仅由根 manifest 的 packageManager 提供。

发布认证沿用参考项目的 npm Trusted Publisher：publish job 显式设置 `id-token: write` 与 `contents: read`，安装支持 OIDC 的 npm CLI，不注入 NPM_TOKEN。各包 npm 后台需绑定 `flash-tunnel/flash-dns` 和精确文件名 `release.yaml`；后台状态尚未核验。

不把 GitHub Actions 的 OIDC 权限原样复制到 GitLab CI。认证依据实际发布平台选择，仓库 URL 也不意味着用户已经完成 npm Trusted Publisher 绑定。

## publish-checklist

用户明确要求应用：[本地 SKILL.md](C:/Users/imba97/.agents/skills/publish-checklist/SKILL.md)。虽然该技能默认排除 CLI，本项目按用户要求复用其中适用的元数据和发布配置检查，并补充 CLI 特有验证。

| 检查 | 处理原则 |
| --- | --- |
| packageManager | 根 manifest 固定版本，避免 workflow 再指定冲突来源 |
| repository | 来自真实 remote，目标为 github.com/flash-tunnel/flash-dns |
| homepage / bugs | 根据实际仓库填写，不使用旧项目地址 |
| license | 依据用户选择及本项目 LICENSE，不能默认 MIT |
| author | 使用已明确的信息，不编造姓名或联系方式 |
| engines.node | 与构建 target、运行依赖和 CI 兼容测试一致 |
| files / bin / exports / types | 用实际构建产物和 pack 内容验证 |
| 私有根包 | private: true，发布时跳过 |
| Trusted Publisher | 仅选择此路线时核对平台、权限、组织、仓库、workflow 绑定 |
| Token 发布 | 仅选择此路线时设置真实凭据注入，不保留无效变量引用 |

GitHub Actions 采用 Trusted Publisher 时，检查 publish job 的 `id-token: write` 和所需最小权限；注意 job 权限覆盖顶层权限。npm 后台绑定以实际 workflow 文件名为准，不能假定仅凭仓库文件已验证后台配置。

skill 的自动修复范围描述存在一般规则和细则差异。本项目对有明确来源的元数据和已选择的 CI 配置进行修复；许可证、发布认证方式和后台设置不得靠推测补齐。

检查 JSON 时使用 JSON.parse，修改后重新解析并检查 diff。记录检查结果、修复前后和遗留项。发布检查不等于执行 publish、commit 或 tag。

## CLI 发布内容检查

- 在临时目录安装 pack 产物，执行 `flash-dns --help`、`--version`。
- 验证用户入口 defineConfig 和 SDK 的 ESM 导入及类型声明。
- 验证仅安装 core 和所选适配器即可使用 SDK，不依赖 CLI 装配。
- 验证 npx 场景中的 TS 配置导入。
- 检查 tarball 不包含凭据、会话状态、测试临时数据或无意发布的大文件。
