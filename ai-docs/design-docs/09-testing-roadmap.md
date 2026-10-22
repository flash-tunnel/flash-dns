# 09 · 测试与实施顺序

## 测试原则

Vitest 为主。通过注入 fetcher、logger、时间、取消信号和文件 fixture 测试行为，不依赖真实 Cloudflare 凭据。

测试重点是冲突、归属、幂等、不确定结果和调用方生命周期。避免只复述实现或为简单导出堆无意义用例。

## 关键测试

| 模块 | 必须验证 |
| --- | --- |
| 命名 | scoped name 转换、大小写、非法字符、63 字符边界、未知变量、缺失变量 |
| 域名 | 显式 hostname 校验、Zone 标签边界、通配输入、CNAME 目标不接受 URL |
| 配置 | CLI/env/file/default 优先级、false 保留、路径基准、错误定位、npx defineConfig 导入 |
| 归属 | 相同名称不同 owner 冲突、无标记不接管、旧 flash-tunnel 标记不自动继承 |
| 幂等 | 第二次 ensure 为 noop，记录 ID 不变；显式更新不先删除 |
| 多记录 | 完整分页、同名其他用途记录保留、候选不唯一报错 |
| 删除 | ID 和 owner 重新核对、已不存在成功、同名新 ID 不误删 |
| 失败 | 429、5xx、超时后实际已创建、取消、过期计划、权限失败不无限重试 |
| Cloudflare | API envelope、字段规范化、代理与 TTL、元数据、脱敏 |
| CLI | JSON stdout 可逐行解析、CI 不挂起、退出码、取消、spinner 收尾 |
| 打包 | pack 后 bin、SDK、config 导入和声明可用，依赖隔离正确 |

完整域名生成测试必须包含：

```text
@org-name/project-name
  + {project}.slidev.acewill.dev
  → org-name-project-name.slidev.acewill.dev
```

同名冲突测试必须包含 `@org/name` 与 `org-name`，不能仅测试标准化函数输出相同。

## 适配器契约测试

建立可复用的契约测试辅助模块，首版可放在测试目录，不必先发布 testing 包。

每个适配器验证：能力声明准确、结果模型一致、按 ID 更新、分页完整、未找到语义、错误映射、取消和秘密不进入结果。

真实服务商测试是显式启用的独立流程，使用测试 Zone 和唯一 owner，清理只覆盖本次确切创建的记录。常规单测、install 和 build 不会操作真实 DNS。

## 阶段 0：设计文档（本次范围）

- 建立项目目录及 ai-docs/design-docs。
- 固化已确认需求，标记建议 API 和待确认事项。
- 检查相对文档链接、示例一致性及职责边界。

验收：文档可作为实现输入，不宣称功能已完成。

## 阶段 1：工程骨架

- pnpm workspace 和包入口。
- antfu ESLint、nano-staged、simple-git-hooks、EditorConfig。
- 严格 TS、unbuild、stub、Vitest 和最小 bin。
- 明确仓库元数据、许可证和包发布作用域。

验收：干净目录安装后 build / lint / typecheck / test 通过。

## 阶段 2：类型、命名、配置

- types/config 的公共导出。
- 默认标准化、模板、变量及 Zone 边界校验。
- unconfig 加载、优先级和来源追踪。
- SDK 显式上下文与 npx 配置 fixture。

验收：命名案例正确，所有非法输入明确失败，不创建云资源。

## 阶段 3：核心协调与 Cloudflare

- 适配器 CRUD、分页、规范化和错误。
- plan / ensure / remove 及 owner。
- 幂等、原位更新、重试、取消和不确定结果处理。

验收：mock 契约和核心测试通过，未归属记录不会被修改。

## 阶段 4：CLI 与打包

- init / plan / ensure / list / remove / doctor。
- reporter、非交互模式和 JSON 输出。
- 用户文档、pack smoke、publish-checklist 报告。

验收：打包后 CLI 和 SDK 均可使用，未填写真实凭据时只报明确配置错误。

## 阶段 5：flash-tunnel 接入

- 保留其旧契约的桥接层。
- 新 ref 的会话持久化、退出清理、keep 和恢复测试。
- 确认旧记录兼容策略，再逐步替换旧 DNS 实现。

验收：临时记录和持久记录生命周期均由调用方控制，不发生跨会话删除。

## 后续方向

其他服务商、可插拔外部归属状态、显式接管、多值记录集协调、跨进程锁均需要独立设计和契约测试，不作为首版隐含承诺。
