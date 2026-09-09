import type { PetListItem, PresetPetItem } from '../types'
import { describe, expect, it } from 'vitest'
import { hasAvailablePets } from './availability'

function preset(installed: boolean): PresetPetItem {
  return { id: 'maid-deepseek-whale', installed, name: 'Maid DeepSeek Whale' }
}

function listItem(id: string, source: PetListItem['source']): PetListItem {
  return { id, name: id, source }
}

describe('hasAvailablePets', () => {
  it('空清单 → false', () => {
    expect(hasAvailablePets([], [], [])).toBe(false)
  })

  it('仅有未安装的预设宠物（可下载但不可用）→ false', () => {
    expect(hasAvailablePets([preset(false)], [], [])).toBe(false)
  })

  it('已安装的预设宠物 → true', () => {
    expect(hasAvailablePets([preset(true)], [], [])).toBe(true)
    expect(hasAvailablePets([preset(false), preset(true)], [], [])).toBe(true)
  })

  it('任意本地 chat/codex 宠物 → true', () => {
    expect(hasAvailablePets([], [listItem('chat-pet', 'chat')], [])).toBe(true)
    expect(hasAvailablePets([], [], [listItem('codex-pet', 'codex')])).toBe(true)
    expect(hasAvailablePets([preset(false)], [listItem('a', 'chat')], [])).toBe(true)
  })
})
