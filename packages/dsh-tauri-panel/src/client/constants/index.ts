/** Stable client-side identifiers shared by the panel implementation. */
export { PANEL_CONTENT_ADAPTIVE_MAX, PANEL_CONTENT_ADAPTIVE_MIN, PANEL_CONTENT_DEFAULT, PANEL_CONTENT_EDGE_BUDGET, PANEL_CONTENT_MIN, PANEL_WIDTH_PREF_KEY, PANEL_WIDTH_VARS } from './width'

export const PANEL_PROTOCOL_SERVICE = 'panel.protocol'
export const PANEL_VIEW_SLOT = 'conversation'
export const PANEL_VIEW_COMPONENT_ID = 'dsh-tauri-panel-conversation-seat'
export const PANEL_STYLE_ID = 'dsh-tauri-panel-styles'
export const SIDEBAR_STYLE_ID = 'dsh-tauri-panel-sidebar-styles'
export const ACTION_ITEM_STYLE_ID = 'dsh-tauri-panel-action-item-styles'
export const CONVERSATION_SEAT_STYLE_ID = 'dsh-tauri-panel-conversation-seat-styles'
export const COLLAPSE_SETTLE_MS = 150
export const SCROLLBAR_LINGER_MS = 2000
export const SIDEBAR_INTERACTIVE_SELECTOR = 'button,a[href],input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="treeitem"][aria-selected]'
export const WORKSPACE_GROUP_SELECTOR = '[role="treeitem"][aria-expanded]'

/**
 * 只改变侧栏呈现、不应关闭面板的官方控件。dsh-client-ui-workspace 的工作区头部
 * “分组方式”（viewOptions.label）与“添加工作区”（workspace.add）按钮的
 * aria-label 随 locale 变化（仓库仅内置 zh/en 两组），这里同时匹配两种语言。
 */
export const SIDEBAR_KEEP_OPEN_SELECTOR = 'button[aria-label="视图选项"],button[aria-label="View options"],button[aria-label="添加工作区"],button[aria-label="Add workspace"]'

export const PANEL_DATA_ATTRIBUTES = {
  sidebar: 'data-dshp-panel-sidebar',
  active: 'data-dshp-panel-active',
  action: 'data-dshp-panel-action',
  view: 'data-dshp-panel-view',
  widthHandle: 'data-width-handle',
} as const

/**
 * 官方侧栏语义的兼容 class 锚点。桌面端用 priority -1 整槽替换了官方 ui-sidebar，
 * 而纯 Web 生态插件（dsh-web 的 dsh-task-board / dsh-ssh 等）不接 sidebar.panel.action
 * 协议，改为按官方 CSS module class 的 **camelCase 子串** 做纯 DOM 注入：
 *   - `[class*="logoRow"]`（取 logoRow 块的 parentElement 作为注入 root）
 *   - `button[class*="newSession"]`（入口行插到新会话块与 workspace 浏览器之间）
 * 克隆侧栏的 class 是 kebab 命名（dshp-panel__logo-row 等），子串不匹配 → 入口永不挂载。
 * 因此在「等价语义」的克隆元素上追加携带官方 camelCase 子串的 token（不参与任何样式），
 * 让这类插件的选择器能命中：panel-area 充当新会话所在块（logoRow token），其内的新会话
 * 菜单项携带 newSession token，注入行落入 panel-area 与 region-area 之间。
 */
export const PANEL_SIDEBAR_COMPAT_CLASS = {
  logoRow: 'dshp-panel-compat-logoRow',
  newSession: 'dshp-panel-compat-newSession',
} as const
