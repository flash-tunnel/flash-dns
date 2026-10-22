# 首版开发报告

日期：2026-10-22。

## 已实现

- 六包 pnpm workspace，ESM 和显式 exports，Node >=22.14，统一版本 0.1.0。
- antfu ESLint、EditorConfig、nano-staged、simple-git-hooks、严格 TypeScript、unbuild build / stub、Vitest。
- 公共适配器 v1 契约、结构化错误、owner、可序列化 ref、AbortSignal 和事件 logger。
- scoped 项目名称标准化、模板变量、Git branch 按需读取、hostname / Zone 边界、A / AAAA / CNAME / TXT 校验。
- unconfig + jiti alias 配置加载，显式路径、向上发现、字段来源和 CLI > env > file > 默认优先级。
- plan / ensure / remove，执行前复查、幂等、原位更新、拒绝隐式接管、多候选检查、按 ID 删除和删除快照检查。
- Cloudflare Zone 校验、完整分页、CRUD、自动 TTL / proxied 约束、版本化 owner comment、HTTP 错误映射、有限读取重试、取消、写入响应丢失后的状态确认。
- init / plan / ensure / list / remove / doctor，非交互删除保护、NDJSON、退出码、TTY spinner 和凭据脱敏。
- README、独立 tarball 安装验证和 Windows / Linux、Node 22.14 / 24 的验证 CI 配置。

## 工程决定

- 用户明确选择 MIT，根目录及全部公开包均包含 LICENSE。
- 使用文档建议的 @flash-dns 作用域，发布权限仍待实际核对。
- TypeScript 固定 5.9.3，以匹配 unbuild 3 的 peer 范围；其余主要工具固定精确版本，peer 检查通过。
- 同一 manager 串行执行全部写操作。跨进程锁仍由调用方负责，API 竞态不能完全消除。
- Cloudflare owner 编码为 `flash-dns:v1:` + base64url(JSON 数组)，保守限制 500 字符。PATCH 不改写已有 comment、tags 或 settings。
- 读取请求有限重试；写请求失败后只恢复查询，不直接重发。未确认成功的写入交由调用方后续重新 ensure。
- 暂未提供纯函数命名器、外部归属后端或资源接管；模板与显式 hostname 已覆盖首版场景。
- 人类结果采用可读 JSON 文本；TTY 显示操作 spinner，取消路径停止并移除本次注册的信号监听。
- 本地初始化 main 和目标 origin；首版提交 801d7d4 已通过 SSH 443 端口推送到 main。尚未发布。
- 发布 CI 已按用户要求对齐 flash-tunnel：文件名 release.yaml，唯一监听 v* tag，跨平台 verify 全部通过后使用 OIDC 发布。npm 后台 Trusted Publisher 绑定仍需核对。

## 验证

本地环境为 Windows，Node 26.12.1，pnpm 12.14.0。

- build：六包构建成功。
- stub：六包开发入口成功，之后恢复正式构建。
- lint / typecheck：通过。
- test：46 项离线测试通过，包括可复用适配器契约测试。
- pack smoke：六个 tarball 的产物、LICENSE、入口、SDK 依赖隔离、ESM 导入、类型声明、类型选项约束、CLI help/version 和 npx 类配置场景通过。
- peer dependency：无冲突。
- CI 文件已配置；尚未在 GitHub runner 上执行，不将配置矩阵当作已通过结果。

测试使用内存 Cloudflare API fixture，不使用真实凭据。真实 Zone 集成验证尚未执行。

## publish-checklist 结果

应用用户指定的 [publish-checklist](C:/Users/imba97/.agents/skills/publish-checklist/SKILL.md)，按设计文档将适用项扩展到 CLI。

| 字段 | 状态 | 初始化前 | 当前 |
| --- | --- | --- | --- |
| packageManager | 通过 | 无 manifest | 根包 pnpm@12.14.0，CI 不重复指定版本 |
| repository | 通过 | 设计目标 | 与实际 origin 对应，包含各包 directory |
| homepage / bugs | 通过 | 无 | flash-tunnel/flash-dns README 与 issues |
| license | 通过 | 待用户选择 | 用户明确选择 MIT，全部包附 LICENSE |
| author | 待补充（建议项） | 未明确 | 未编造作者姓名或邮箱 |
| engines.node | 通过元数据校验 | 参考基线 | >=22.14.0，构建 target node22；最低版本运行验证由 CI 覆盖 |
| files / exports / types / bin | 通过 | 无 | tarball 实测入口、声明、shebang 和内容 |
| 根包 private | 通过 | 无 | true，不打包发布根包 |
| registry 权限 | 待核对 | 未核验 | 未进行 npm 登录或后台权限检查 |
| 发布认证 / OIDC | 仓库配置通过，后台待核对 | 未配置 | release.yaml 的 publish job 已设 id-token: write 和 contents: read，无 token 变量 |

全部工程文件为新增；原设计文档同步了实现状态和工具版本。没有现有业务代码被替换。

## 后续范围

- npm 组织、包名、发布权限和各包 release.yaml Trusted Publisher 绑定的实际核验。
- 推送发布 tag 后运行 release.yaml，补充真实测试 Zone 的受控集成验证。
- flash-tunnel 桥接、旧会话兼容、keep 和恢复测试属于后续跨仓库集成，本轮未修改 flash-tunnel。
