# 实施清单

已勾选仅表示实际完成，不表示方案被讨论过。

## 本次文档工作

- [x] 创建 `D:\Projects\flash-dns`。
- [x] 创建 `ai-docs/design-docs`。
- [x] 记录产品边界和首版范围。
- [x] 记录 monorepo、CLI、核心库及适配器依赖方向。
- [x] 记录 scoped 项目名标准化、模板、Zone 和名称冲突。
- [x] 记录幂等、归属、删除、并发和不确定结果。
- [x] 记录 Cloudflare 复用点及 flash-tunnel 迁移设计。
- [x] 记录 ESLint、antfu、nano-staged、hooks、TS、构建和测试规范。
- [x] 纳入用户指定的 publish-checklist。
- [x] 记录实施顺序和后续验收条件。

## 工程初始化

- [x] 检查远端初始内容，按用户后续要求克隆或初始化 Git；目标为 `git@github.com:flash-tunnel/flash-dns.git`。
- [x] 明确本项目许可证并创建 LICENSE。
- [ ] 核对 npm 包、`@flash-dns` 组织和发布权限。
- [x] 建立 workspace 和六个包。
- [x] 配好 antfu ESLint、EditorConfig 和 gitignore。
- [x] 配好 nano-staged、simple-git-hooks 和 prepare。
- [x] 配好严格 TS、unbuild、stub 和 Vitest。
- [x] 核验包元数据和构建产物入口。

## 首版实现

- [x] 适配器公共契约和错误。
- [x] 命名规则、配置加载和 npx 场景。
- [x] Cloudflare CRUD、分页、归属元数据和能力校验。
- [x] plan / ensure / remove 的协调流程。
- [x] init / list / doctor 和 CLI 展示。
- [x] JSON 输出、非交互模式、取消与脱敏。
- [x] 测试关键失败路径并验证实际 pack 产物。
- [x] 进行发布检查，报告差异和遗留项。

## 后续集成

- [x] 配置工具本身的跨平台 CI 验证。
- [x] 确定发布 CI 文件名为 release.yaml，唯一触发为 v* tag，并采用 npm Trusted Publisher。
- [ ] 核对各包 npm Trusted Publisher 的仓库和 release.yaml 绑定。
- [ ] 设计并实施 flash-tunnel 桥接层。
- [ ] 验证旧会话、keep 和异常恢复。
- [ ] 在明确的测试 Zone 进行受控集成验证。

## 当前决定与待定项

| 项目 | 当前状态 |
| --- | --- |
| 产品名与仓库 | 已确认 flash-dns、github.com/flash-tunnel/flash-dns |
| 项目目录 | 已按同级项目惯例创建 D:\Projects\flash-dns |
| 许可证 | 用户于 2026-10-22 明确选择 MIT，已创建 LICENSE |
| npm 作用域 | 拟使用 @flash-dns；用户已建组织，实际权限待核对 |
| 包版本 | 统一 0.1.0 |
| 配置文件与 API 命名 | 已落地，精确接口见根 README |
| CI / registry / 认证 | release.yaml 只监听 v* tag，验证后使用 OIDC 发布；npm 后台绑定和权限待核对 |
| 真实 DNS 操作 | 未执行；离线测试不使用凭据，受控测试 Zone 待指定 |

首版独立工具代码、依赖和离线验证已完成，详见 [开发报告](../implementation-report.md)。首版提交已通过 SSH 推送到 main；发布 workflow 已配置，尚未推送发布 tag 或执行 npm 发布。未修改 flash-tunnel，未操作真实 DNS。
