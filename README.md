# dsh-429-guard

DeepSeek Harness（DSH）插件 —— **429 / 配额不足错误自动无限重试守卫**。

在 DSH Web UI 右上角挂一个精美浮窗（盾牌入口胶囊 + 展开卡片），带开关。开启后，模型请求遇到 429（含 DeepSeek 返回的 `429 insufficient_quota`，被官方归类为 `QUOTA`）会**自动无限次重试**，直至成功或你手动停止，避免任务中断。

## 它解决什么问题

使用 DSH 时，模型 API 经常返回：

```
429: {"message":"Allocated quota exceeded, please increase your quota limit.","type":"invalid_request_error","code":"insufficient_quota"}
```

官方 `dsh-llm-retry` 插件在 `normal` 模式下达到 `maxRetries` 即放弃 → 抛出 `LlmError` → 当前 turn 中断，长任务半途而废。本插件在重试链中**接管官方插件放弃之后的 429 类错误**，继续无限重试（退避等待，可被 agent 的 abort signal 取消）。

## 功能特性

- **右上角精美浮窗**：玻璃拟态胶囊（盾牌 + 状态点 + 重试计数徽标），点击展开卡片（标题、说明、Toggle 开关、统计、正在重试呼吸灯、清零计数）。
- **开关即生效**：开启 = 429 类无限重试；关闭 = 放行，恢复官方默认行为。
- **覆盖面广**：判定 `code ∈ {RATE_LIMIT, QUOTA}` 或 `status === 429` 或文案命中 `429/rate limit/quota/insufficient_quota`，确保覆盖 `insufficient_quota`。
- **与官方 llm-retry 兼容共存**：waterfall 链中排在官方之后接管，不冲突；若 provider 配了 `always` 模式，官方自身已无限重试，本插件不被触发。
- **可取消**：退避等待监听 agent 的 abort signal，用户手动停止时立即放弃。
- **统计持久化**：累计重试次数、最近拦截时间、最近错误，存于 `$(DSH_HOME)/storages/dsh-429-guard.json`。

## 安装

### 从 GitHub 安装（推荐）

```bash
dsh plugin --profile web add github:suufon/dsh-429-guard
```

安装后**重启 / 重载 DSH 应用**，右上角出现盾牌浮窗即安装成功。

> 想固定版本可加 tag：`dsh plugin --profile web add github:suufon/dsh-429-guard#v0.1.0`

### 从本地目录安装（插件开发）

```bash
dsh plugin --profile web add "file:<你克隆/解压到的路径>"
```

### 重启 DSH Web

插件在启动时加载，安装后需重启 dsh web：

```powershell
# 仓库内自带脚本（自动探测 DSH_HOME / dsh CLI）
pwsh -File .\scripts\restart-web.ps1
```

参数：`-Action stop|start|restart`（默认 `restart`）、`-ShowWindow`（显示服务器日志窗口）。
脚本会自动探测 `DSH_HOME` 与 dsh CLI，也可用 `-DshHome` / `-DshCmd` 显式指定。

> 强制刷新安装：`dsh plugin --profile web remove dsh-429-guard && dsh plugin --profile web add github:suufon/dsh-429-guard`

> 卸载：`dsh plugin --profile web remove dsh-429-guard`

## 使用

1. 点击右上角盾牌胶囊（可拖动到任意位置），展开卡片。
2. 打开「自动无限重试」开关（默认开启则无限重试；也可设「最大重试次数 / 最长重试时长」设防，达到上限即放弃本轮重试、任务按原流程失败）。
3. 之后模型请求遇到 429 / 配额不足，会自动重试；卡片上显示累计次数与「正在重试」状态。
4. 若最近一次错误是 `QUOTA`（配额耗尽），卡片显示醒目警示（提示检查账户），胶囊状态点变黄。
5. 不需要时关闭开关即可恢复默认行为；可点「清零」重置统计。

## 架构

DSH 是「主机平面 cordis 插件 + 客户端插件」双层架构，本插件对应两部分：

```
┌───────────────────────────── DSH Web（浏览器） ─────────────────────────────┐
│  lib/client.js（shell.overlay 浮窗，React）                                    │
│    └─ 轮询 /guard-api/state + POST /guard-api/enable                          │
└───────────────────────────┬──────────────────────────────────────────────────┘
                            │ 同源 fetch（loopback 可信）
┌───────────────────────────▼──────────────────────────────────────────────────┐
│  lib/index.js（主机端 cordis 插件，inject: ['webServer']）                     │
│    ├─ ctx.on('agent/request-error', …) → 429 类无限重试                        │
│    └─ ctx.webServer.register('/guard-api', …) → state / enable / reset        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 429 重试链路（agent loop）

```
模型请求 → 流式响应 → finish.kind === 'error'
  → dispatch.waterfall('agent/request-error', { failure, retryPolicy, signal, … }, fallback)
      ├─ dsh-llm-retry: normal 模式 previousRetry >= maxRetries → return next()（放弃）
      └─ dsh-429-guard（本插件）:
            开关关闭 / 非 429 类 → return next()（放行，抛出 LlmError，任务中断）
            开关开启 + 429 类     → 退避等待（signal 可取消）→ return { kind: 'retry' }
                                    agent loop continue → 重新发起请求（无限次）
```

`failure` 来自 `LlmError.failure`：`{ message, code, status?, providerRetryAfterMs?, requestId? }`。
DeepSeek 的 `429 insufficient_quota` 经 `isQuotaExceededError` 归类为 `code = 'QUOTA'`（`QUOTA_EXCEEDED_CODE = 'QUOTA'`），本插件据此接管。

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/guard-api/state` | 读取开关状态 + 统计 + 当前活动重试 |
| `POST` | `/guard-api/enable` | body `{ "enabled": true/false }` 切换开关（持久化） |
| `POST` | `/guard-api/reset` | 清零统计计数 |

所有路由仅 loopback 可信（同源、127.0.0.1/::1），防止远程 CSRF。

## 退避策略

- 优先使用 provider 返回的 `retry-after`（`failure.providerRetryAfterMs`），封顶 240s。
- 否则指数退避：`initial 2s × 2^(retry-1)`，封顶 60s，抖动 ±25%。
- 等待期间监听 agent 的 abort signal；用户手动停止时立即放弃。

## License

MIT
