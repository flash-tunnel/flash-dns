# 07 · Cloudflare 与 flash-tunnel 集成

## 首版 Cloudflare 适配器

实现范围：

- Token 的实际权限检查和错误映射。
- 通过明确 zoneId 或 Zone 名称定位 Zone，校验状态与 hostname 归属。
- 分页查询、按 ID 获取、创建、原位更新和删除记录。
- A、AAAA、CNAME、TXT 的服务商字段转换。
- Cloudflare proxied 扩展、TTL 规范化、记录元数据归属。
- 请求超时、取消、限流退避、脱敏和可注入 fetcher。

只为 DNS 操作申请所需权限，按使用方式限制到目标 Zone。通过名称发现 Zone 时需要对应读取权限；固定 zoneId 可减少发现操作。不要继承 flash-tunnel 中创建 Tunnel 所需的账户级权限。

doctor 通过实际 DNS 读取验证可用性，不把 Token 状态为 active 等同于拥有所有操作权限；不会为了测试写权限创建临时记录。

## 参考代码

源项目：`D:\Projects\flash-tunnel`。

| 文件 | 可借鉴 | 需要改变 |
| --- | --- | --- |
| packages/adapter-cloudflare/src/api.ts | fetch 封装、超时、服务商错误映射、Zone 查询 | 移除 Tunnel API，补更新和完整分页 |
| packages/adapter-cloudflare/src/dns.ts | 记录转换、冲突查询、comment 标记 | 不再删除后重建；归属匹配精确到 owner |
| packages/core/src/domain.ts | 项目名、模板、标签校验 | 不绑定隧道，不默认随机命名，显式 hostname 也必须校验 |
| packages/core/src/config/ | unconfig、配置来源、npx 场景 | 使用 flash-dns 自己的配置和独立契约 |
| packages/cli/src/ui/ | reporter、theme、非交互模式 | 只呈现 DNS 操作，不带入隧道状态机 |

优先抽取有用的能力和设计，不复制整个临时预览会话系统。源项目当前有 MIT LICENSE；实际复制代码时保留必要版权和许可声明。新项目的许可证仍需明确选择，不能由参考项目推定。

## 服务商状态与公网访问

- proxied 是 Cloudflare 扩展，不是“所有 DNS 都应该有”的基础字段。
- 创建指向 `<tunnel-id>.cfargotunnel.com` 的记录，只是设置目标，不验证或创建 Tunnel。
- 服务商 API 写入成功，不代表 Tunnel 在线、网站健康或全球 DNS 缓存已刷新。
- 通配记录可以作为输入，但不能代替配置 HTTPS 证书。

用户案例 `project.slidev.acewill.dev` 属于较深层级域名。在 Cloudflare 全量 DNS 托管的常见配置中，Universal SSL 不覆盖该层；证书需要调用方安排。flash-dns 文档提示这个边界，核心操作不申请证书，也不以证书就绪作为写 DNS 的前提。

参考：[Cloudflare DNS](https://developers.cloudflare.com/dns/)、[Universal SSL 覆盖限制](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)。

## flash-tunnel 接入步骤

1. 先完成 flash-dns 的 core、Cloudflare 适配器和契约测试。
2. 在 flash-tunnel 内实现桥接层，把原 DNS adapter 契约映射到新 SDK。
3. flash-tunnel 继续创建和启动 Tunnel，并将返回的 DNS target 传给 flash-dns。
4. flash-tunnel 提供 hostname 和 session owner，将新 ref 写入自己的资源账本。
5. 就绪、退出和异常恢复仍由 flash-tunnel 控制；需要时显式调用 DNS remove。
6. 验证多会话共存、退出清理、异常恢复、keep 行为后，再替换旧实现。

## 旧记录兼容

- 既有 `flash-tunnel:` comment 不自动当作新 `flash-dns` owner。
- 新 SDK 不根据“同一工具家族”越过归属检查。
- 旧会话优先按旧流程结束；若必须恢复旧会话，通过桥接层显式验证旧账本、recordId 和内容。
- 如需迁移标记，单独输出迁移计划，不作为普通 ensure 的隐藏副作用。
- 迁移完成前保留旧 ref 的读取和清理能力，避免遗留 DNS。

本次只设计接入方式，不修改 flash-tunnel 仓库。
