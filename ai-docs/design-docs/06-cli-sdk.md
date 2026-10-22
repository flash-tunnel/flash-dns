# 06 · CLI 与 SDK

本文件记录首版设计，CLI 和 SDK 已实现；精确参数、环境变量和当前行为见 [项目 README](../../README.md)。

## CLI 命令

| 命令 | 目的 | 写操作 |
| --- | --- | --- |
| init | 创建配置模板和稳定项目身份，不覆盖已有文件 | 本地配置 |
| plan | 显示名称、目标记录、归属、预期变更及冲突 | 无 |
| ensure | 将单条受管记录协调到期望状态 | DNS |
| list | 查询记录，支持 name / owner 等过滤 | 无 |
| remove | 预览并删除明确选择且归属匹配的记录 | DNS |
| doctor | 检查配置、凭据、Zone 和适配器可用性 | 无 |

```bash
flash-dns init
flash-dns plan
flash-dns ensure --json
flash-dns list --name project.slidev.acewill.dev
flash-dns remove --record-id <id> --yes
flash-dns doctor
```

未传命令时显示帮助，不默认创建资源。无 `deploy`、Tunnel bootstrap 或服务器初始化命令。

通用参数：`--cwd`、`--config`、`--provider`、`--zone`、`--hostname`、`--project`、`--json`、`--silent`、`--verbose`、`--no-color`、`--yes`。

具体记录参数和 owner 选择器应与配置字段一一对应，解析逻辑集中管理。不要接受 API Token 命令行参数，避免出现在进程列表和 shell 历史中。

## SDK 示例

```ts
import { createCloudflareAdapter } from '@flash-dns/adapter-cloudflare'
import { createDnsManager } from '@flash-dns/core'

const dns = createDnsManager({
  adapter: createCloudflareAdapter({
    apiToken,
    zoneId
  })
})

const result = await dns.ensure({
  zone: 'acewill.dev',
  name: 'project.slidev.acewill.dev',
  type: 'CNAME',
  content: `${tunnelId}.cfargotunnel.com`,
  owner: {
    application: 'flash-tunnel',
    id: sessionId
  },
  providerOptions: {
    proxied: true
  }
})

// 稍后由 flash-tunnel 的生命周期决定是否调用。
await dns.remove(result.ref)
```

`apiToken`、`zoneId`、`tunnelId` 和 `sessionId` 均由调用方提供。providerOptions 根据注入适配器获得相应类型约束，不将 Cloudflare 字段硬编码为所有服务商通用字段。

命名函数和配置解析提供独立导出；SDK 使用方既可以使用项目规则，也可以像示例一样直接提供完整 name。

## 返回值

ensure 返回 action（created / updated / unchanged）、实际记录和 ref。plan 返回 operation、期望状态、已有状态和冲突原因。

SDK 返回结构化对象和错误，不直接打印文本或退出进程。删除返回 removed / already-absent。

ref 必须能被序列化，方便 flash-tunnel 写入会话状态，进程恢复后继续按 ID 清理。ref 不包含服务商凭据。

## 终端输出

- 使用 cac 定义命令，prompts 与 yocto-spinner 处理交互和进度。
- core 发结构化事件，CLI reporter 统一展示。
- 色彩集中在 theme 模块，其他业务代码不直接拼 ANSI。
- `--json` stdout 仅输出 NDJSON；人类日志和子进程噪声走 stderr。
- 非 TTY、CI、JSON 模式禁用交互提示及 spinner。
- spinner 在 finally 和取消路径正确停止，恢复终端光标。
- Token、Authorization、凭据文件内容和完整敏感配置不进入日志。

拟议事件包括 plan、record:created、record:updated、record:unchanged、record:removed、error、exit，携带可关联的 requestId。

## 退出码（建议）

| 代码 | 含义 |
| --- | --- |
| 0 | 成功，包括 noop 和 already-absent |
| 1 | 未分类内部错误或服务商错误 |
| 2 | 配置、命名或参数错误 |
| 3 | 冲突、归属或候选不唯一 |
| 4 | 认证或权限错误 |
| 5 | 适配器不兼容或能力不支持 |
| 6 | Zone 或记录定位失败 |
| 7 | 限流、超时等重试耗尽 |
| 130 | 用户取消 |

plan 发现冲突时也以非零码退出，但仍输出完整计划，方便 CI 判断。
