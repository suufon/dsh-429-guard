/**
 * dsh-429-guard, node half.
 *
 * 主机端 cordis 插件：
 *   1. 监听 agent loop 的 `agent/request-error` waterfall 事件，在开关开启时
 *      对 429 / 配额不足(insufficient_quota) 类错误做无限次自动重试
 *      （退避等待、可被 agent 的 abort signal 取消），避免任务中断。
 *   2. 在 web 服务器注册 /guard-api 路由（loopback 可信），供浏览器半
 *      读取/切换开关、查询统计。
 *
 * 设计要点：
 *   - 与官方 `dsh-llm-retry` 兼容共存。该插件在 normal 模式下重试次数
 *     达到 maxRetries 即放弃（return next()），本插件排在其后接管，
 *     对 429 类错误继续无限重试；若 provider 配置了 always 模式则官方
 *     插件自身已无限重试，本插件不会被触发（waterfall 已短路）。
 *   - 429 类判定宽松：code ∈ {RATE_LIMIT, QUOTA} || status===429
 *     || 文案命中 429/rate.?limit/quota/insufficient_quota，确保覆盖
 *     DeepSeek 返回的 `429 insufficient_quota`（被官方归类为 QUOTA）。
 *   - 无限重试只在开关开启时生效；关闭即放行（return next()），恢复
 *     官方默认行为。开关状态持久化到 ~/.dsh/storages/dsh-429-guard.json。
 *
 * ⚠ 会话日志安全（v0.1.1 修复）：
 *   本插件**不再**向会话日志写入任何自定义事件类型。
 *
 *   旧版本（v0.1.0）会执行
 *       session.append('429-guard/retry', {...})
 *       session.append('429-guard/give-up', {...})
 *   这会把 `429-guard/retry` 这种引擎词表之外的事件类型写进持久化的
 *   session log。DSH 的读取路径对未知事件类型是 fail-closed 的：
 *       if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true)
 *           throw unsupported(`... contains event type "${event.type}" ... refusing to interpret the log`)
 *   而 live 的 `Session.append()` **无法**设置 `ignorable: true` 标记，
 *   于是任何一个写入了该事件的会话在重启后就再也打不开（文件完好，
 *   但引擎拒绝解释整份日志），用户表现为"历史加载失败"。
 *
 *   DSH 官方插件编写指南同样明令禁止：
 *       "Do not append session events with a new `type`. ... Derive state
 *        from existing events, or keep plugin-owned data in a storage
 *        service found through inspection."
 *
 *   因此本插件改为：
 *     - 重试决策与统计全部留在插件自己的 storage（~/.dsh/storages/dsh-429-guard.json）；
 *     - 需要在会话轨迹里留痕时，改用引擎**已知的** `llm/retry` /
 *       `llm/retry-started` 事件类型（与官方 dsh-llm-retry 同形），
 *       这样任何版本的引擎都能正确解释；
 *     - 绝不引入词表之外的事件类型。
 *
 *   如需完全静默，可在 cordis.patch.yml 中设置 `logToSession: false`
 *   （默认 false，即不写会话日志）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

export const inject = ['webServer']

// 429 类错误的稳定 code 集合（与 dsh-llm 的 HarnessError code 对齐）。
const RATE_LIMIT_CODE = 'RATE_LIMIT'
const QUOTA_CODE = 'QUOTA'
// 文案兜底正则：捕获各类 429 / 限流 / 配额措辞（含 insufficient_quota）。
const TEXT_429_RE = /\b429\b|\brate[\s_-]?limit\b|\binsufficient[\s_-]+quota\b|\bquota[\s_-]?(?:exceeded|exhausted|reached)\b|\bexceed(?:ed|s)?[\s_-]+(?:your|the)?[\s_-]*(?:current)?[\s_-]*quota\b/i

// 退避参数。
const INITIAL_DELAY_MS = 2000
const MAX_DELAY_MS = 60000
const JITTER_RATIO = 0.25

// 引擎已知的 retry 事件类型（见 KNOWN_SESSION_EVENT_TYPES）。
// 使用它们而不是自定义类型，可以让任何版本的 DSH 都能解释这份日志。
const RETRY_EVENT_TYPE = 'llm/retry'
const RETRY_STARTED_EVENT_TYPE = 'llm/retry-started'

// 本插件使用的 retryPolicyKey 形态，与官方 dsh-llm-retry 的 normal 模式
// 保持一致（引擎不校验该字段内容，但保持同形便于日志阅读）。
const POLICY_KEY = JSON.stringify(['always', INITIAL_DELAY_MS, MAX_DELAY_MS, JITTER_RATIO])

function stateFilePath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-429-guard.json')
}

function loadState() {
  const path = stateFilePath()
  try {
    if (!existsSync(path)) return defaultState()
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    // 深度合并 caps（旧状态文件可能缺字段，避免整块覆盖）。
    const caps = { ...defaultState().caps, ...(parsed && parsed.caps ? parsed.caps : {}) }
    return { ...defaultState(), ...parsed, caps }
  } catch (err) {
    console.warn('[429-guard] load state failed:', String(err && err.message || err))
    return defaultState()
  }
}

function defaultState() {
  return {
    enabled: false,
    // 是否把重试记到会话日志（用引擎已知的 llm/retry 事件类型）。
    // 默认 false：统计写在插件自己的 storage 里，不碰会话日志。
    logToSession: false,
    // 逃生阀：null = 不限（纯无限重试）；数字 > 0 时到达上限即放弃本轮重试。
    caps: {
      maxRetries: null, // 最大重试次数
      maxRetryMs: null, // 最长重试时长（毫秒）
    },
    stats: {
      retriesTotal: 0,
      blockedTotal: 0,
      last429At: null,
      lastRetryAt: null,
      lastFailure: null,
    },
  }
}

// 归一化设防值：null / 空 / 非法 → null（不限）；正整数才保留。
function capValue(value, min) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) return null
  return Math.floor(n)
}

function saveState(state) {
  const path = stateFilePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.warn('[429-guard] save state failed:', String(err && err.message || err))
  }
}

// 429 类判定：综合 code / status / 文案。
function isRateLimited(failure) {
  if (!failure || typeof failure !== 'object') return false
  if (failure.code === RATE_LIMIT_CODE || failure.code === QUOTA_CODE) return true
  if (failure.status === 429) return true
  const text = [failure.message, failure.code, failure.requestId].filter((s) => typeof s === 'string').join(' ')
  if (TEXT_429_RE.test(text)) return true
  // cause 链里可能携带原始响应体（DeepSeek 把 JSON 原文塞进 cause.message）。
  let cause = failure.cause
  let guard = 0
  while (cause && guard++ < 6) {
    const cm = cause && (cause.message || String(cause))
    if (cm && TEXT_429_RE.test(cm)) return true
    cause = cause && cause.cause
  }
  return false
}

function backoffDelayMs(retry, providerRetryAfterMs) {
  if (Number.isFinite(providerRetryAfterMs) && providerRetryAfterMs > 0) {
    return Math.min(providerRetryAfterMs, MAX_DELAY_MS * 4)
  }
  const exponent = Math.min(retry - 1, 5)
  const base = Math.min(INITIAL_DELAY_MS * 2 ** exponent, MAX_DELAY_MS)
  const jitter = 1 - JITTER_RATIO + 2 * JITTER_RATIO * Math.random()
  return Math.min(base * jitter, MAX_DELAY_MS)
}

function cancellableDelay(delayMs, signal) {
  if (!signal || signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (signal.removeEventListener) signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    if (signal.addEventListener) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 把一次失败规整成 `llm/retry` 事件要求的 failure 形状。
 * LlmFailure 只接受 message / code / status / providerRetryAfterMs / requestId / offloadImages。
 */
function toLlmFailure(failure) {
  if (!failure || typeof failure !== 'object') {
    return { message: 'model request failed', code: 'UNKNOWN' }
  }
  const out = {
    message: typeof failure.message === 'string' ? failure.message : 'model request failed',
    code: typeof failure.code === 'string' ? failure.code : 'UNKNOWN',
  }
  if (typeof failure.status === 'number') out.status = failure.status
  if (typeof failure.providerRetryAfterMs === 'number') out.providerRetryAfterMs = failure.providerRetryAfterMs
  if (typeof failure.requestId === 'string') out.requestId = failure.requestId
  return out
}

export function apply(ctx) {
  const state = loadState()
  // 运行期活动重试上下文（同一时刻最多一个 agent 在重试；多 agent 并发时
  // 各自维护 turn/step，统计累加即可）。
  const active = new Map()

  function snapshot() {
    return {
      ok: true,
      enabled: !!state.enabled,
      logToSession: !!state.logToSession,
      caps: { ...state.caps },
      stats: { ...state.stats },
      active: active.size > 0 ? Array.from(active.values()) : null,
    }
  }

  // 逃生阀判定：设防后返回 true 表示放弃本轮重试（交由后续链，任务按原流程失败）。
  function capExceeded(key, retry, startedAt) {
    const caps = state.caps || {}
    if (caps.maxRetries != null && retry > caps.maxRetries) return true
    if (caps.maxRetryMs != null && Number.isFinite(startedAt) && Date.now() - startedAt > caps.maxRetryMs) return true
    return false
  }

  /**
   * 可选：把一次重试记进会话日志。
   *
   * 只使用引擎已知的 `llm/retry` / `llm/retry-started` 事件类型，因此这份
   * 日志对任何版本的 DSH 都是可解释的。绝不使用自定义事件类型——那会让
   * 会话在下次打开时被引擎 fail-closed 拒绝。
   */
  function appendRetryEvent(session, { retryId, retry, turn, step, provider, delayMs, failure }) {
    if (!session || typeof session.append !== 'function') return
    try {
      session.append(RETRY_EVENT_TYPE, {
        retryId,
        turn,
        step,
        provider,
        mode: 'always',
        policyKey: POLICY_KEY,
        retry,
        delayMs,
        failure: toLlmFailure(failure),
      })
    } catch (err) {
      console.warn('[429-guard] could not append llm/retry event:', String(err && err.message || err))
    }
  }

  function appendRetryStartedEvent(session, { retryId, retry, turn, step }) {
    if (!session || typeof session.append !== 'function') return
    try {
      session.append(RETRY_STARTED_EVENT_TYPE, { retryId, turn, step, retry })
    } catch (err) {
      console.warn('[429-guard] could not append llm/retry-started event:', String(err && err.message || err))
    }
  }

  // ── agent/request-error：429 类无限重试 ──────────────────────────────
  const disposeListener = ctx.on('agent/request-error', async (payload, next) => {
    const failure = payload && payload.failure
    if (!state.enabled || !isRateLimited(failure)) return next()

    const { turn, step, provider, signal } = payload
    const key = `${provider}:${turn}:${step}`
    const prior = active.get(key)
    const retry = (prior?.retry || 0) + 1
    const startedAt = prior?.startedAt || Date.now()
    const retryId = prior?.retryId || `d429-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

    // 逃生阀：超过最大重试次数 / 最长重试时长 → 放弃本轮重试。
    if (capExceeded(key, retry, startedAt)) {
      active.delete(key)
      console.warn(
        `[429-guard] ESCAPE HATCH: 放弃对 ${provider} (turn ${turn}, step ${step}) 的重试 ` +
        `(retry #${retry}, caps=${JSON.stringify(state.caps)}) — 任务将按原流程失败`
      )
      // 放弃时同样只记录统计，不写自定义会话事件。
      state.stats.lastFailure = {
        code: failure && failure.code,
        status: failure && failure.status,
        message: failure && failure.message,
        provider,
      }
      saveState(state)
      return next()
    }

    const delayMs = backoffDelayMs(retry, failure && failure.providerRetryAfterMs)

    // 统计累加（仅每轮更新一次，避免持久化抖动）。
    state.stats.retriesTotal += 1
    state.stats.blockedTotal += 1
    state.stats.last429At = new Date().toISOString()
    state.stats.lastRetryAt = state.stats.last429At
    state.stats.lastFailure = {
      code: failure && failure.code,
      status: failure && failure.status,
      message: failure && failure.message,
      provider,
    }
    active.set(key, { provider, turn, step, retry, retryId, delayMs, since: state.stats.last429At, startedAt })

    const quotaNote = failure && failure.code === QUOTA_CODE ? ' [QUOTA 配额已耗尽，可能需检查账户]' : ''
    console.log(
      `[429-guard] retry #${retry} for ${provider} (turn ${turn}, step ${step}) in ${Math.round(delayMs)}ms — ` +
      `${failure && failure.code} ${failure && failure.status ? '(HTTP ' + failure.status + ')' : ''}${quotaNote}`
    )

    // 可选留痕：仅当用户显式开启 logToSession 时，使用引擎已知的
    // llm/retry 事件类型写入会话日志。
    if (state.logToSession) {
      appendRetryEvent(payload.agent && payload.agent.session, {
        retryId, retry, turn, step, provider, delayMs, failure,
      })
    }

    // 异步落盘统计（不阻塞重试决策）。
    const snap = JSON.stringify(state)
    queueMicrotask(() => saveState(JSON.parse(snap)))

    // 退避等待；被 signal 中止则放弃（agent 已被用户停止）。
    const proceeded = await cancellableDelay(delayMs, signal)
    active.delete(key)
    if (!proceeded) return next() // signal 中止：交给后续链（最终抛出错误）。

    // 无限重试：返回 retry decision，agent loop 会 continue 重新发起请求。
    if (state.logToSession) {
      appendRetryStartedEvent(payload.agent && payload.agent.session, {
        retryId, retry, turn, step,
      })
    }
    return { kind: 'retry' }
  })

  ctx.effect(() => async () => {
    if (typeof disposeListener === 'function') disposeListener()
    // 进程退出时落盘最新统计。
    saveState(state)
  }, '429-guard: dispose listener + flush state')

  // ── /guard-api REST 路由（loopback 可信）──────────────────────────────
  function isTrustedApiRequest(req) {
    const host = req.headers.host || ''
    const hostUrl = (() => { try { return new URL('http://' + host) } catch { return null } })()
    if (!hostUrl) return false
    const ip = req.socket && req.socket.remoteAddress
    if (ip && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
      // loopback：放行。
    } else {
      return false
    }
    const origin = req.headers.origin
    if (origin === undefined) return true
    try { return new URL(origin).host === hostUrl.host } catch { return false }
  }

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  async function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  async function handle(req, res) {
    if (!isTrustedApiRequest(req)) { res.writeHead(403); res.end('forbidden'); return }
    let url
    try { url = new URL(req.url, 'http://localhost') } catch {
      res.writeHead(400); res.end('bad request'); return
    }
    const pathname = url.pathname

    if (pathname === '/guard-api/state' && req.method === 'GET') {
      sendJson(res, 200, snapshot())
      return
    }

    if (pathname === '/guard-api/enable' && req.method === 'POST') {
      let body
      try { body = await readBody(req, 65536) } catch {
        sendJson(res, 400, { ok: false, error: String('body too large') }); return
      }
      let args
      try { args = JSON.parse(body || '{}') } catch {
        sendJson(res, 400, { ok: false, error: 'JSON 解析失败' }); return
      }
      const enabled = args.enabled === true || args.enabled === 'true'
      state.enabled = enabled
      if (args.logToSession === true || args.logToSession === 'true') state.logToSession = true
      if (args.logToSession === false || args.logToSession === 'false') state.logToSession = false
      saveState(state)
      console.log('[429-guard] enabled =', enabled, 'logToSession =', state.logToSession)
      sendJson(res, 200, snapshot())
      return
    }

    if (pathname === '/guard-api/reset' && req.method === 'POST') {
      state.stats = defaultState().stats
      saveState(state)
      sendJson(res, 200, snapshot())
      return
    }

    if (pathname === '/guard-api/caps' && req.method === 'POST') {
      let body
      try { body = await readBody(req, 65536) } catch {
        sendJson(res, 400, { ok: false, error: 'body too large' }); return
      }
      let args
      try { args = JSON.parse(body || '{}') } catch {
        sendJson(res, 400, { ok: false, error: 'JSON 解析失败' }); return
      }
      state.caps = {
        maxRetries: capValue(args.maxRetries, 1),
        maxRetryMs: capValue(args.maxRetryMs, 1000),
      }
      saveState(state)
      console.log('[429-guard] caps =', JSON.stringify(state.caps))
      sendJson(res, 200, snapshot())
      return
    }

    res.writeHead(404)
    res.end('not found')
  }

  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/guard-api',
      handler: handle,
    }))
    console.log('[429-guard] /guard-api routes registered')
  } else {
    console.warn('[429-guard] webServer service unavailable — REST API disabled (retry still active)')
  }
}
