# 04 · 适配器契约

## 原则

适配器封装服务商的 API 和字段差异；核心库负责计划、幂等和归属规则。适配器不包含 CLI 交互、命名模板或临时会话清理。

第一版建立 `apiVersion: 1`，CLI 和核心库在装配时验证版本及必要方法。接口以实际可实现的 Cloudflare 行为为基线，不承诺跨服务商事务。

## 概念模型（建议）

```ts
interface DnsRecord {
  id: string
  zoneId: string
  name: string
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT'
  content: string
  ttl: number | 'auto'
  ownership?: Ownership
  providerData?: Record<string, unknown>
}

interface Ownership {
  application: string
  id: string
}

interface DnsAdapter {
  id: string
  apiVersion: 1
  capabilities: DnsCapabilities

  resolveZone: ResolveZone
  listRecords: ListRecords
  getRecord: GetRecord
  createRecord: CreateRecord
  updateRecord: UpdateRecord
  deleteRecord: DeleteRecord
}
```

方法名及类型是设计示意；完整签名在实现时补齐。写方法必须支持通过记录 ID 操作，不能用“先删除整个名称再创建”代替更新。

## 记录输入与输出

- 输入使用完整 hostname、明确 type、content、ttl 和 owner。
- TXT 内容是原始文本，不通过域名标准化转换，不随意修改大小写或引号。
- A / AAAA 校验地址格式；CNAME 校验目标域名，不接受 URL 或路径。
- ttl 未显式指定时，创建使用已文档化默认值；更新保留既有可选值。
- 查询输出保留实际服务商状态，不能把缺失字段默认为 false 后用于覆盖。
- 适配器负责服务商侧规范化，例如域名大小写或尾点、TTL 自动值和代理约束。
- providerData 仅携带必要的非敏感数据，不包含 API Token 或完整请求头。

## 能力声明

| 能力 | 用途 |
| --- | --- |
| recordTypes | 声明当前实现支持哪些类型 |
| update | 是否支持原位更新 |
| wildcard | 是否支持通配记录 |
| ttl | 支持自动 TTL、秒数范围和约束 |
| ownership | 元数据、外部状态或暂不支持 |
| lookupByName | 是否支持名称精确查询 |
| extensions | 服务商扩展，例如 Cloudflare proxied |

能力表示适配器已实现的功能，不等同于服务商全部能力。传入不支持的选项时返回 `CAPABILITY_UNSUPPORTED`，不能静默忽略。

首个 Cloudflare 适配器使用记录元数据保存归属。其他服务商若不支持记录元数据，可在后续版本设计外部状态后端；首版不实现该后端，不假装所有服务商都能安全执行无状态归属判断。

## 调用上下文

- AbortSignal：允许调用方取消操作。
- logger：结构化日志，默认可为空实现。
- requestId：用于日志关联，不作为资源归属。
- fetcher：由适配器构造参数注入，便于 mock 请求。
- 时间来源与随机来源按需注入；core 不读 CLI 的全局变量。

底层方法返回单页信息或由适配器遍历分页；核心业务查询必须明确覆盖全部结果，不能只检查第一页。

## 错误契约

统一错误携带 `code`、`message`、`hint`、`retriable`、可选 cause 和已脱敏 details。

建议稳定错误码：

```text
CONFIG_INVALID / NAME_INVALID / TEMPLATE_VARIABLE_MISSING
CAPABILITY_UNSUPPORTED / ADAPTER_INCOMPATIBLE
AUTH_INVALID / PERMISSION_DENIED
ZONE_NOT_FOUND / ZONE_NOT_ACTIVE
RECORD_CONFLICT / OWNERSHIP_MISMATCH / AMBIGUOUS_RECORD
RECORD_NOT_FOUND / PLAN_STALE / PROVIDER_ERROR
RATE_LIMITED / REQUEST_TIMEOUT / OPERATION_ABORTED
```

第三方适配器将原始服务商错误映射到公共错误，同时保留可诊断的非敏感状态码。调用方不依赖 Cloudflare 专有数字错误码判断业务分支。

## 适配器装配

SDK 首版支持显式传入适配器对象。CLI 首版内建 Cloudflare 的装配入口；后续可支持通过包名或程序化配置加载第三方适配器，并先验证契约。

不在首版建立服务商市场或动态下载执行插件的机制。
