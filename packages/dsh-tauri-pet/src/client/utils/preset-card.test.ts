import { describe, expect, it } from 'vitest'
import { progressPercent, resolvePresetCardAction, resolvePresetCardUpdate } from './preset-card'

function progress(phase: PresetDownloadPhase, received = 0, total = 0): { phase: PresetDownloadPhase, received: number, total: number, error?: string | null } {
  return { phase, received, total }
}

type PresetDownloadPhase = 'idle' | 'downloading' | 'extracting' | 'done' | 'failed'

describe('resolvePresetCardAction', () => {
  const maid = { id: 'maid-deepseek-whale', installed: false, phase: 'idle' as const }

  it('已选仅限已安装的当前宠物；未安装的当前宠物（默认预设）给出下载入口', () => {
    // 内置归一 id 与预设卡 id 相同：新装环境默认宠物未下载，卡片不能显示已选（issue #401）。
    expect(resolvePresetCardAction(maid, 'maid-deepseek-whale', progress('downloading'))).toBe('downloading')
    expect(resolvePresetCardAction(maid, 'maid-deepseek-whale', null)).toBe('download')
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'maid-deepseek-whale', null)).toBe('selected')
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'maid-deepseek-whale', progress('downloading'))).toBe('selected')
  })

  it('激活 id 为空串（全新安装无默认选择）：未安装给出下载、已安装给出启用', () => {
    // 不再默认选中内置宠物；active_pet 为空 → 任何预设卡都不显示「已选」。
    expect(resolvePresetCardAction(maid, '', null)).toBe('download')
    expect(resolvePresetCardAction({ ...maid, installed: true }, '', null)).toBe('enable')
  })

  it('下载/解压中显示 downloading，不因已安装而跳到 enable', () => {
    expect(resolvePresetCardAction(maid, 'other', progress('downloading'))).toBe('downloading')
    expect(resolvePresetCardAction(maid, 'other', progress('extracting'))).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'other', progress('downloading'))).toBe('downloading')
  })

  it('无轮询进度时用清单 phase 恢复下载中视图（跨挂载场景）', () => {
    expect(resolvePresetCardAction({ ...maid, phase: 'downloading' }, 'other', null)).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, phase: 'extracting' }, 'other', null)).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, phase: 'done' }, 'other', null)).toBe('download')
    expect(resolvePresetCardAction({ ...maid, phase: 'failed' }, 'other', null)).toBe('download')
  })

  it('已安装且非当前 → enable；未安装 → download', () => {
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'other', null)).toBe('enable')
    expect(resolvePresetCardAction(maid, 'other', null)).toBe('download')
    expect(resolvePresetCardAction(maid, 'other', progress('done'))).toBe('download')
    expect(resolvePresetCardAction(maid, 'other', progress('failed'))).toBe('download')
  })
})

describe('resolvePresetCardUpdate', () => {
  const maid = { id: 'maid-deepseek-whale', installed: true, update_available: true, phase: 'idle' as const }

  it('已安装且可更新 → 显示更新按钮', () => {
    expect(resolvePresetCardUpdate(maid, null)).toBe(true)
    expect(resolvePresetCardUpdate(maid, progress('done'))).toBe(true)
  })

  it('未安装 / 清单未提示更新 → 不显示', () => {
    expect(resolvePresetCardUpdate({ ...maid, installed: false }, null)).toBe(false)
    expect(resolvePresetCardUpdate({ ...maid, update_available: false }, null)).toBe(false)
    expect(resolvePresetCardUpdate({ ...maid, update_available: undefined }, null)).toBe(false)
  })

  it('下载/解压中 → 隐藏更新按钮（避免与替换安装冲突）', () => {
    expect(resolvePresetCardUpdate(maid, progress('downloading'))).toBe(false)
    expect(resolvePresetCardUpdate(maid, progress('extracting'))).toBe(false)
    // 清单 phase 兜底（跨挂载恢复下载中视图）。
    expect(resolvePresetCardUpdate({ ...maid, phase: 'downloading' }, null)).toBe(false)
    expect(resolvePresetCardUpdate({ ...maid, phase: 'extracting' }, null)).toBe(false)
  })
})

describe('progressPercent', () => {
  it('已知总量返回截断百分比', () => {
    expect(progressPercent(progress('downloading', 50, 200))).toBe(25)
    expect(progressPercent(progress('downloading', 200, 200))).toBe(100)
    expect(progressPercent(progress('downloading', 300, 200))).toBe(100)
  })

  it('未知总量：下载早期与解压中均返回 null（不确定进度）', () => {
    expect(progressPercent(progress('downloading'))).toBeNull()
    expect(progressPercent(progress('extracting'))).toBeNull()
    expect(progressPercent(progress('idle'))).toBe(0)
  })
})
