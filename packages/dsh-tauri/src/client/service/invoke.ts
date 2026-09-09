import type { InvokeBridgeReply, InvokeBridgeRequest } from '../types'
/**
 * dsh-tauri invoke 桥（iframe 侧客户端）。
 *
 * iframe 内的 dsh 界面 / 插件没有 `__TAURI_INTERNALS__`（只有顶层 webview 有），
 * 因此无法直接 `import { invoke } from '@tauri-apps/api/core'`。本桥把这些调用
 * 经 postMessage 转发到宿主（主 webview）的监听器（见桌面端
 * `src/hooks/use-iframe-invoke.ts`），由宿主调用 Tauri `invoke` 并把结果回传。
 *
 * 协议（与宿主监听器逐字一致）：
 *   iframe → 宿主：{ source: 'dsh-tauri-invoke', type: 'dsh://tauri:invoke',
 *                     cmd, args, nonce }
 *   宿主 → iframe：{ source: 'dsh-desktop-invoke', type: 'dsh://tauri:reply',
 *                     nonce, ok, value | error }
 *
 * 可靠性：每条请求带唯一 nonce，应答按 nonce 精确匹配避免串线；等待超时
 * （INVOKE_TIMEOUT_MS）或局部失败统一 reject，并登记进宿主错误注册表便于排查。
 */
import { INVOKE_TIMEOUT_MS, PLUGIN_ID, SRC_INVOKE, SRC_INVOKE_REPLY, TYPE_INVOKE, TYPE_INVOKE_REPLY } from '../constants'

let nonceSeq = 0

/** 生成全局唯一的请求 nonce（`<pluginId>:<seq>`，进程内递增）。 */
function nextNonce(): string {
  nonceSeq += 1
  return `${PLUGIN_ID}:${nonceSeq}`
}

/**
 * 经宿主桥调用一个 Tauri command，返回其成功值；command 抛错或超时时 reject。
 *
 * @param cmd  Tauri command 名（如 `get_pet_status`）
 * @param args command 参数对象（可选）
 * @typeParam T command 成功返回值的类型
 */
export function invokeBridgedTauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const nonce = nextNonce()

  return new Promise<T>((resolve, reject) => {
    let settled = false
    // 定时器句柄：settle 成功/失败路径与 postMessage 抛错路径都要清理，避免高频
    // 成功调用留下一 15s 的休眠超时闭包（见 issue #396 前端延迟根因之一）。
    let timer: ReturnType<typeof setTimeout> | undefined

    function onMessage(event: MessageEvent<unknown>): void {
      // 只接受宿主（顶层）直接发回的应答，且 nonce 必须命中本次请求
      if (event.source !== window.parent)
        return
      const data = event.data as InvokeBridgeReply | null
      if (!data || typeof data !== 'object' || data.source !== SRC_INVOKE_REPLY)
        return
      if (data.type !== TYPE_INVOKE_REPLY || data.nonce !== nonce)
        return
      settle(data)
    }

    function settle(reply: InvokeBridgeReply): void {
      if (settled)
        return
      settled = true
      if (timer !== undefined)
        clearTimeout(timer)
      // issue #396 修复：完成路径（成功/失败）都必须清理超时计时器，避免高频成功调用遗留「休眠超时闭包」。
      window.removeEventListener('message', onMessage)
      if (reply.ok) {
        resolve(reply.value as T)
      }
      else {
        reject(new Error(reply.error || `NODE_NOT_ANSWERED: invoke ${cmd} rejected by host`))
      }
    }

    window.addEventListener('message', onMessage)
    // 超时保护：宿主未应答（监听器未挂载/iframe 非 dsh 环境等）时按失败处理
    timer = setTimeout(() => {
      if (settled)
        return
      window.removeEventListener('message', onMessage)
      settled = true
      reject(new Error(`NODE_NOT_ANSWERED: invoke ${cmd} timed out`))
    }, INVOKE_TIMEOUT_MS)

    const request: InvokeBridgeRequest = {
      source: SRC_INVOKE,
      type: TYPE_INVOKE,
      cmd,
      args,
      nonce,
    }
    try {
      window.parent.postMessage(request, '*')
    }
    catch (error) {
      if (timer !== undefined)
        clearTimeout(timer)
      if (settled)
        return
      settled = true
      window.removeEventListener('message', onMessage)
      reject(error)
    }
  })
}
