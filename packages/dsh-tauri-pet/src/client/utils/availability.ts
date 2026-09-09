import type { PetListItem, PresetPetItem } from '../types'

/**
 * 是否存在可直接使用的宠物：已安装的预设宠物（installed）或任意本地 chat/codex
 * 宠物。未安装的预设（仅可下载）不算可用——启用后没有可播放资产，侧栏切换
 * 入口对用户没有意义；无任何可用宠物时侧栏入口图标隐藏。
 */
export function hasAvailablePets(
  presets: readonly PresetPetItem[],
  chatPets: readonly PetListItem[],
  codexPets: readonly PetListItem[],
): boolean {
  return presets.some(item => item.installed) || chatPets.length > 0 || codexPets.length > 0
}
