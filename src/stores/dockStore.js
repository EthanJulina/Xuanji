// ============================================================
// 玄机 - Dock 域 store(v2.1 重构)
// 职责:三档模式 / 固定管理(上限 10)/ 运行区合成 / 互斥判定 / Dock 内动作
// 数据:settings.dock = { mode, pinnedToolIds, iconSize }
//      挂在全局 settings 上,随 tools.json 走统一 persist 原子落盘
// 边界:与工具自身的 pinned(星标「常用」)是两套独立机制,互不影响
// ============================================================
import { reactive, computed } from 'vue'
import {
  s, toolById, persist, toast, openContextMenu, askRun, isRunning, killByTool
} from '../composables/store'
import { listConfigs } from './launchConfigStore'

export const DOCK_LIMIT = 10

/* ---------------- 域内状态 ---------------- */
export const dock = reactive({
  peek: false,                                  // auto 模式:当前是否滑出
  dragId: null, overId: null, dragPos: null     // 固定区拖拽排序状态
})

// settings.dock 兜底(init / 导入配置后调用;含旧 showDock 布尔映射)
export function ensureDockSettings() {
  const st = s.data.settings
  if (!st.dock || typeof st.dock !== 'object') {
    // 旧版 showDock:false → off,true/缺省 → auto(新默认)
    st.dock = { mode: st.showDock === false ? 'off' : 'auto', pinnedToolIds: [], iconSize: 44 }
  }
  const d = st.dock
  if (!['auto', 'fixed', 'off'].includes(d.mode)) d.mode = 'auto'
  if (!Array.isArray(d.pinnedToolIds)) d.pinnedToolIds = []
  if (![36, 44, 52].includes(d.iconSize)) d.iconSize = 44
  // 清理已删除工具的引用(防御:删除工具后 id 残留)
  const alive = new Set(s.data.tools.map(t => t.id))
  d.pinnedToolIds = d.pinnedToolIds.filter(id => alive.has(id))
}

/* ---------------- 派生 ---------------- */
export const dockMode = computed(() => s.data.settings.dock?.mode ?? 'auto')
export const dockFixedShow = computed(() => dockMode.value === 'fixed')   // 常驻(驱动主内容预留 padding)

// 互斥:命令面板 / 任意弹窗 / 日志面板 / 确认框 / 右键菜单打开时,Dock 强制隐藏且不可唤出
export const dockBlocked = computed(() =>
  s.palette.open || s.toolModal.open || s.comboModal.open || s.wsModal.open ||
  s.wsAddTools.open || s.catModal.open || s.deleteModal.open ||
  s.logPanel.open || s.confirmState.open || s.ctxMenu.open
)

/* ---- 内容合成:固定区 + 运行区(正在运行但未固定,按工具去重,保持启动顺序) ---- */
export const dockPinnedTools = computed(() =>
  (s.data.settings.dock?.pinnedToolIds || []).map(id => toolById(id)).filter(Boolean)
)

export const dockRunningExtras = computed(() => {
  const pinned = new Set(s.data.settings.dock?.pinnedToolIds || [])
  const seen = new Set()
  const out = []
  for (const p of s.procs) {
    if (pinned.has(p.toolId) || seen.has(p.toolId)) continue
    const t = toolById(p.toolId)
    if (t) { seen.add(p.toolId); out.push(t) }
  }
  return out
})

/* ---------------- 固定管理 ---------------- */
export function isDockPinned(toolId) {
  return (s.data.settings.dock?.pinnedToolIds || []).includes(toolId)
}

export function toggleDockPin(tool) {
  ensureDockSettings()
  const ids = s.data.settings.dock.pinnedToolIds
  const i = ids.indexOf(tool.id)
  if (i > -1) {
    ids.splice(i, 1)
    toast(`已从 Dock 移除「${tool.name}」`, 'success')
  } else {
    if (ids.length >= DOCK_LIMIT) { toast(`Dock 最多固定 ${DOCK_LIMIT} 个工具`, 'error'); return }
    ids.push(tool.id)
    toast(`已固定「${tool.name}」到 Dock`, 'success')
  }
  persist()
}

export function reorderDockPinned(orderedIds) {
  ensureDockSettings()
  s.data.settings.dock.pinnedToolIds = orderedIds.slice(0, DOCK_LIMIT)
  persist()
}

/* ---------------- 模式切换(设置页,即时生效并持久化) ---------------- */
export function setDockMode(mode) {
  ensureDockSettings()
  if (!['auto', 'fixed', 'off'].includes(mode)) return
  s.data.settings.dock.mode = mode
  dock.peek = false
  persist()
}

/* ---------------- Dock 内动作 ---------------- */
// 单击:未运行 → 以 active 启动配置运行;已在运行 → 弹同款菜单(结束 / 再次启动)
export function dockClick(e, tool) {
  if (isRunning(tool.id)) dockMenu(e, tool, true)
  else askRun(tool)
}

// 右键菜单:打开 / 以配置运行(列出该工具全部启动配置)/ 结束进程(运行中)/ 从 Dock 移除(固定区)
export function dockMenu(e, tool, inDock) {
  const items = []
  const running = isRunning(tool.id)
  if (!running) items.push({ icon: '▶️', label: '打开', action: () => askRun(tool) })
  for (const c of listConfigs(tool)) {
    const isActive = c.id === tool.activeLaunchConfigId
    items.push({ icon: isActive ? '✅' : '🎬', label: `以「${c.name}」运行`, action: () => askRun(tool, c.id) })
  }
  if (running) items.push({ icon: '⏹', label: '结束进程', danger: true, action: () => killByTool(tool.id) })
  if (inDock) items.push({ icon: '⚓', label: '从 Dock 移除', action: () => toggleDockPin(tool) })
  openContextMenu(e, items)
}
