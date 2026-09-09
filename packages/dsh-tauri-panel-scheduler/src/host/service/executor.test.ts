import { describe, expect, it, vi } from 'vitest'
import { loadSchedulerRuntimeModules, settlesWithin, unattendedToolGuardReason } from './executor'

describe('loadSchedulerRuntimeModules', () => {
  it('resolves DSH-owned modules through the platform loader', async () => {
    const installModelSelection = vi.fn()
    const createUserMessage = vi.fn()
    const setApprovalPolicy = vi.fn()
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', { installModelSelection }],
      ['@deepseek-ai/dsh-llm', { createUserMessage }],
      ['@deepseek-ai/dsh-user-approval', { setApprovalPolicy }],
    ])
    const loader = {
      import: vi.fn(async (name: string) => modules.get(name)),
      unwrapExports: vi.fn((value: unknown) => value),
    }

    const runtime = await loadSchedulerRuntimeModules(loader)

    expect(loader.import).toHaveBeenCalledTimes(3)
    expect(loader.import).toHaveBeenNthCalledWith(1, '@deepseek-ai/dsh-agent')
    expect(loader.import).toHaveBeenNthCalledWith(2, '@deepseek-ai/dsh-llm')
    expect(loader.import).toHaveBeenNthCalledWith(3, '@deepseek-ai/dsh-user-approval')
    expect(runtime).toEqual({ installModelSelection, createUserMessage, setApprovalPolicy })
  })

  it('prefers named exports when unwrapExports selects a default export', async () => {
    const installModelSelection = vi.fn()
    const createUserMessage = vi.fn()
    const setApprovalPolicy = vi.fn()
    const loader = {
      import: vi.fn(async (name: string) => ({
        ...(name === '@deepseek-ai/dsh-agent' ? { installModelSelection } : {}),
        ...(name === '@deepseek-ai/dsh-llm' ? { createUserMessage } : {}),
        ...(name === '@deepseek-ai/dsh-user-approval' ? { setApprovalPolicy } : {}),
        default: { wrongExport: true },
      })),
      unwrapExports: vi.fn(() => ({ wrongExport: true })),
    }

    const runtime = await loadSchedulerRuntimeModules(loader)

    expect(runtime).toEqual({ installModelSelection, createUserMessage, setApprovalPolicy })
    expect(loader.unwrapExports).not.toHaveBeenCalled()
  })
})

describe('unattendedToolGuardReason', () => {
  it('allows bookkeeping, goal, job, delegation, and orchestration tools', () => {
    // standard 预设目录里的安全类别：会话内簿记 / 目标延续 / agent 级 job / 委派编排。
    const allowed = [
      'todo_write',
      'get_goal',
      'create_goal',
      'update_goal',
      'job_list',
      'job_output',
      'job_kill',
      'list_subagent_models',
      'subagent',
      'subagent_fork',
      'send_message',
      'list_agents',
      'interrupt_agent',
      'workflow',
      'ralph',
      'cordis_define',
      'cordis_run',
      'cordis_stop',
      'cordis_undefine',
    ]
    for (const name of allowed)
      expect(unattendedToolGuardReason(name, {})).toBeUndefined()
  })

  it('allows tools and background shell calls because the host owns permissions', () => {
    expect(unattendedToolGuardReason('ask_user_question', {})).toBeUndefined()
    expect(unattendedToolGuardReason('scheduler_create', {})).toBeUndefined()
    expect(unattendedToolGuardReason('bash', { command: 'ls', run_in_background: true })).toBeUndefined()
    expect(unattendedToolGuardReason('pwsh', { command: 'ls', run_in_background: true })).toBeUndefined()
  })
})

describe('settlesWithin', () => {
  it('resolves true when the promise settles before the timeout', async () => {
    const result = await settlesWithin(Promise.resolve('done'), 500)
    expect(result).toBe(true)
  })

  it('resolves false when the promise settles with a rejection before the timeout', async () => {
    const result = await settlesWithin(Promise.reject(new Error('boom')), 500)
    expect(result).toBe(false)
  })

  it('resolves false when the promise does not settle within the timeout', async () => {
    vi.useFakeTimers()
    try {
      const pending = new Promise<void>(() => {})
      const resultPromise = settlesWithin(pending, 50)
      const asserted = resultPromise.then(
        (value) => {
          expect(value).toBe(false)
          return true
        },
        () => false,
      )
      await vi.advanceTimersByTimeAsync(50)
      expect(await asserted).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('resolves before the timeout when the promise settles quickly', async () => {
    vi.useFakeTimers()
    try {
      let settle!: (value: string) => void
      const pending = new Promise<string>((resolve) => {
        settle = resolve
      })
      const resultPromise = settlesWithin(pending, 10_000)
      settle('early')
      const value = await resultPromise
      expect(value).toBe(true)
      // 计时器不应还挂着（已清除）
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      vi.useRealTimers()
    }
  })
})
