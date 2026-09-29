// ============================================================
// 玄机 - 全局搜索索引 store(渲染层)
// 职责:Ctrl+K 统一入口的内存索引与查询
// 覆盖:工具(名称/备注/分类名)、工作空间(名称)、
//       commands / resources(有数据即纳入,无数据自动隐藏分组)
// 防抖 ≤100ms 由 CommandPalette 的 debouncedQuery 驱动
// ============================================================
import { reactive, computed } from 'vue'
import { s, categoryById } from '../composables/store'
import { initialism } from '../utils/pinyin'
import { ws } from './workspaceStore'

const qd = window.qd

export const si = reactive({
  query: '',          // 原始输入(即时)
  debounced: ''       // 防抖后的查询词(≤100ms)
})

/* ---------------- 匹配工具(与旧面板同规则:名称/备注/分类/拼音首字母) ---------------- */
export function matchTool(tool, kw) {
  const lower = kw.toLowerCase()
  const cat = tool.categoryId ? categoryById(tool.categoryId) : null
  const hay = [
    tool.name,
    tool.desc || '',
    cat ? cat.name : '未分类',
    initialism(tool.name)
  ]
  return hay.some(h => String(h).toLowerCase().includes(lower))
}

/* ---------------- 索引构建(内存,computed 自动随数据变化) ----------------
 * 无输入:最近运行 5 项 + 置顶工具(硬性保留原行为)
 * 有关键词:四组结果(工具/工作空间/命令/资源),空组自动隐藏
 */
export const searchGroups = computed(() => {
  const kw = si.debounced.trim()

  // ---- 无输入:保留原有默认视图 ----
  if (!kw) {
    const recent = [...s.data.tools].filter(t => t.lastRunAt)
      .sort((a, b) => String(b.lastRunAt).localeCompare(String(a.lastRunAt))).slice(0, 5)
    const pinned = s.data.tools.filter(t => t.pinned && !recent.includes(t))
    const groups = []
    if (recent.length) groups.push({ key: 'recent', label: '最近运行', kind: 'tool', items: recent })
    if (pinned.length) groups.push({ key: 'pinned', label: '置顶工具', kind: 'tool', items: pinned })
    return groups
  }

  // ---- 有关键词:统一搜索 ----
  const groups = []

  // 工具
  const tools = s.data.tools.filter(t => matchTool(t, kw))
  if (tools.length) groups.push({ key: 'tools', label: `工具 · ${tools.length}`, kind: 'tool', items: tools })

  // 工作空间(名称 / 拼音首字母)
  const workspaces = ws.list.filter(w => {
    const name = (w.name || '').toLowerCase()
    return name.includes(kw.toLowerCase()) || (initialism(w.name) || '').toLowerCase().includes(kw.toLowerCase())
  })
  if (workspaces.length) groups.push({ key: 'workspaces', label: `工作空间 · ${workspaces.length}`, kind: 'workspace', items: workspaces })

  // 命令(P1 数据结构,有数据即纳入)
  const commands = (s.data.commands || []).filter(c =>
    (c.name || '').toLowerCase().includes(kw.toLowerCase()) ||
    (c.desc || '').toLowerCase().includes(kw.toLowerCase()) ||
    (c.tags || []).some(t => String(t).toLowerCase().includes(kw.toLowerCase()))
  )
  if (commands.length) groups.push({ key: 'commands', label: `命令 · ${commands.length}`, kind: 'command', items: commands })

  // 资源(P1 数据结构,有数据即纳入)
  const resources = (s.data.resources || []).filter(r =>
    (r.name || '').toLowerCase().includes(kw.toLowerCase()) ||
    (r.tags || []).some(t => String(t).toLowerCase().includes(kw.toLowerCase()))
  )
  if (resources.length) groups.push({ key: 'resources', label: `资源 · ${resources.length}`, kind: 'resource', items: resources })

  return groups
})

// 扁平化(键盘导航用)
export const flatResults = computed(() => {
  const out = []
  for (const g of searchGroups.value) {
    for (const item of g.items) out.push({ kind: g.kind, group: g.key, item })
  }
  return out
})

/* ---------------- 默认动作(Enter) ----------------
 * 工具 = 以 active 配置运行;工作空间 = 进入;
 * 命令 = 打开运行弹窗(v2.1:变量表单+预览+危险确认;Shift+Enter 才复制);
 * 资源 = 用系统默认程序打开(v2.1)
 */
export async function executeResult(entry, actions) {
  const { kind, item } = entry
  if (kind === 'tool') actions.runTool(item)
  else if (kind === 'workspace') actions.openWorkspace(item)
  else if (kind === 'command') {
    const { openCommandRun } = await import('./commandStore')
    openCommandRun(item)
  } else if (kind === 'resource') {
    const r = await qd.resourceOpen(item.path)
    if (!r.ok) {
      import('../composables/store').then(m => m.toast(r.message || '打开失败', 'error'))
    }
  }
}
