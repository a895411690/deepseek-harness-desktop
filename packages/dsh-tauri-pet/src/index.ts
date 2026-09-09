/**
 * src/index.ts — dsh-tauri-pet 宿主侧（node half）。
 *
 * 方案 1（host → rust → pet webview）：宿主不再让 iframe 客户端对快照做差分
 * （#396 客户端根因），改为在宿主把 `session/event`【增量】总线状态化重建为桌宠
 * 展示态后，经 HTTP SSE 流发布；Rust 用 reqwest 订阅该流并 `emit_to('pet')`。
 *
 * 角色划分：
 *   - host/reducer.ts  纯函数「增量事件 → 桌宠展示态」reducer（单测覆盖）；
 *   - index.ts（本文件） 宿主装配：订阅 session/event + session/disposed，把
 *                        变化经 reducer 投影后广播到 SSE 客户端；
 *   - Rust 消费端       新后台任务 reqwest GET 本 SSE 流 → emit_to
 *                        (pet_window::PET_WINDOW_LABEL, "session:*").
 *
 * 本文件是薄的适配层：把「宿主 session 到底有什么字段」这个无法本会话运行时
 * 验证的不确定性，隔离在 peerOf() 这一处（其余逻辑见 reducer.ts 的单测）。
 */

import type { HostContext, RouteHandler } from 'dsh-tauri'
import type { PetSessionEvent, PetSessionPayload, PetSessionPeer } from './host/reducer'
import { createPetSessionReducer } from './host/reducer'

/** 插件名（诊断元数据）。 */
export const name = 'dsh-tauri-pet'

/** 需要的宿主服务：webServer（SSE 路由）、sessions（session/event 总线）。 */
export const inject = ['webServer', 'sessions']

/** SSE 流路径（Rust 消费端按 `http://127.0.0.1:<DSH_WEB_PORT>` + 此路径订阅）。 */
export const SESSION_STREAM_PATH = '/api/dsh-pet/session-stream'

/**
 * 从宿主 session 对象读取的最小身份字段（运行时形状在此解耦，字段缺失即 undefined）。
 * 标题从宿主 `sessionTitle` 服务（`session/title` 事件折叠）读取 —— 裸 Session 类没有 title。
 */
function peerOf(
  session: unknown,
  event: PetSessionEvent,
  titleOf?: (session: unknown) => string | undefined,
): PetSessionPeer {
  const s = session as {
    id?: unknown
    sessionId?: unknown
    header?: { origin?: 'subagent', cwd?: string }
    summary?: {
      origin?: 'subagent'
      title?: string
      displayTitle?: string
      cwd?: string
      running?: boolean
    }
    title?: string
    displayTitle?: string
    cwd?: string
    running?: boolean
  } | undefined
  const id = typeof s?.id === 'string'
    ? s.id
    : typeof s?.sessionId === 'string'
      ? s.sessionId
      : String(event.data?.sessionId ?? '')
  const header = s?.header
  const summary = s?.summary
  const foldedTitle = titleOf?.(session)
  const title = summary?.title ?? s?.title ?? foldedTitle
  return {
    id,
    origin: summary?.origin ?? header?.origin,
    title,
    displayTitle: summary?.displayTitle ?? s?.displayTitle ?? foldedTitle,
    cwd: summary?.cwd ?? header?.cwd ?? s?.cwd,
    running: typeof summary?.running === 'boolean' ? summary.running : s?.running,
  }
}

/** 把 bus 广播的事件归一化到 reducer 契约（丢弃无 data 载荷的 log-only 噪音由 reducer 兜底）。 */
function asPetEvent(event: unknown): PetSessionEvent {
  const e = event as Partial<PetSessionEvent> | undefined
  return {
    type: typeof e?.type === 'string' ? e.type : '',
    seq: typeof e?.seq === 'number' ? e.seq : 0,
    time: typeof e?.time === 'number' ? e.time : 0,
    data: (e?.data ?? {}) as Record<string, unknown>,
  }
}

/**
 * 插件体：订阅会话增量总线，经 reducer 投影后广播到 SSE 客户端。
 * @param ctx - 宿主根上下文（注入 webServer / sessions）。
 */
export function apply(ctx: HostContext): void {
  // 已接入的 SSE 响应句柄（Rust 订阅者）。断连即移除。
  const clients = new Set<Parameters<RouteHandler>[1]>()

  // 会话标题折叠源：宿主 `sessionTitle` 服务（`session/title` 事件）。可选 —— 未挂载时回退 id。
  const titleService = ctx.get?.('sessionTitle') as
    | { get?: (session: unknown) => { title?: string } | undefined }
    | undefined
  const titleOf = (session: unknown): string | undefined => titleService?.get?.(session)?.title

  const reducer = createPetSessionReducer((action, payload) =>
    broadcast(action, payload))

  function broadcast(action: 'create' | 'update' | 'remove', payload: PetSessionPayload): void {
    for (const res of clients) {
      try {
        res.write(`data: ${JSON.stringify({ action, payload })}\n\n`)
      }
      catch {
        /* 断连写失败由 close 事件清理，忽略。 */
      }
    }
  }

  const sseHandler: RouteHandler = (request, response) => {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      // 本地环回流；开放给同源/桌宠窗口即可（后续可收口为 loopback 校验或 token）。
      'access-control-allow-origin': '*',
    })
    response.write('retry: 1000\n\n')
    clients.add(response)
    // 心跳注释帧，防止代理/空闲断连。
    const ping = setInterval(() => {
      for (const res of clients) {
        try {
          res.write(': keepalive\n\n')
        }
        catch {
          /* ignore */
        }
      }
    }, 15_000)
    const onClose = () => {
      clients.delete(response)
      clearInterval(ping)
      try {
        response.end()
      }
      catch {
        /* ignore */
      }
    }
    request.on('close', onClose)
    request.on('error', onClose)
  }

  // 会话出生：首次出现的 id 推 create，随后交由 apply() 推增量 update。
  const known = new Set<string>()
  ctx.on('session/event', (session: unknown, event: unknown) => {
    const petEvent = asPetEvent(event)
    const peer = peerOf(session, petEvent, titleOf)
    if (!peer.id)
      return
    if (!known.has(peer.id)) {
      known.add(peer.id)
      reducer.create(peer)
    }
    reducer.apply(peer, petEvent)
  })
  ctx.on('session/disposed', (session: unknown) => {
    const peer = peerOf(session, { type: '', seq: 0, time: 0, data: {} }, titleOf)
    if (!peer.id)
      return
    known.delete(peer.id)
    reducer.remove(peer.id)
  })

  // 路由注册 + 卸载清理。
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: SESSION_STREAM_PATH,
      handler: sseHandler,
    })
    return () => {
      disposeRoute()
      for (const res of clients) {
        try {
          res.end()
        }
        catch {
          /* ignore */
        }
      }
      clients.clear()
    }
  }, `${name}: session stream route`)
}
