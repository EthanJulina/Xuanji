// ============================================================
// 玄机 - 前端核心状态层
// 数据(分类/工具/设置)+ 视图状态 + 全局 UI(弹窗/toast/右键菜单)
// 通过 window.qd(preload 桥)与主进程通信
// ============================================================
import { reactive, computed } from 'vue'
import { initialism } from '../utils/pinyin'

const qd = window.qd

/* ---------------- 全局状态 ---------------- */
export const s = reactive({
  loaded: false,
  appInfo: { win11: false, version: '', dataDir: '' },
  data: {
    version: '2.1',
    categories: [],
    tools: [],
    workspaces: [],
    commands: [],
    resources: [],
    globalVars: {},
    proxy: { profiles: [], current: null, snapshot: null },
    sessions: [],
    checks: [],
    settings: {
      theme: 'dark', closeToTray: true, sortMode: 'manual', showDock: true, defaultView: 'home', lastView: null,
      globalShortcut: 'Control+Space',   // v2.2.0 全局呼出快捷键(空串=禁用,设置页可录制)
      run: { defaultCwd: '', dangerPatterns: [] },
      log: { errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 },
      healthCheck: { cacheTtlSec: 300, blockOnFail: true }
    }
  },
  // 视图:home | all | star | cat | uncat | workspace | settings | dev(P1/P2 占位)
  view: { type: 'home', id: null },
  search: '',
  procs: [],                 // 运行中进程(主进程推送,含 cpu/ram 指标)
  procTick: 0,               // 秒级时钟(驱动标题栏运行时长刷新)
  icons: {},                 // toolId → dataURL(自动获取的系统图标缓存)
  collapsed: new Set(),      // 「全部工具」视图下折叠的分类 id

  // ---- 弹窗 / 浮层 UI 状态 ----
  toolModal: { open: false, editId: null, dropPath: null, tab: 'basic' },  // tab: basic | launch
  comboModal: { open: false, editId: null },                 // 组合创建/编辑
  wsModal: { open: false, editId: null },                    // 工作空间新建/编辑
  wsAddTools: { open: false, workspaceId: null },            // 添加工具到工作空间
  predictions: [],           // AI 预测:同时段高频启动的工具
  dismissPredictions: false,
  catModal: { open: false },                      // 分类管理
  deleteModal: { open: false, tool: null },       // 删除确认
  logPanel: { open: false, toolId: null },        // 日志面板
  palette: { open: false },                       // 命令面板 Ctrl+K
  commandRun: { open: false, cmdId: null },       // v2.1 命令运行弹窗(变量表单+预览+危险确认)
  healthPanel: { open: false, toolId: null, configId: null, results: [] },  // v2.1 健康检查拦截面板
  confirmState: { open: false, options: null, resolve: null }, // 通用确认框
  ctxMenu: { open: false, x: 0, y: 0, items: [] },// 全局右键菜单
  toasts: []                                      // toast 队列
})

let saveTimer = null

/* ---------------- 持久化(防抖) ---------------- */
export function persist(immediate = false) {
  clearTimeout(saveTimer)
  const doSave = () => qd.storeSave(JSON.parse(JSON.stringify(s.data)))
  immediate ? doSave() : (saveTimer = setTimeout(doSave, 250))
}

/* ---------------- 初始化 ---------------- */
export async function init() {
  s.appInfo = await qd.appInfo()
  s.data = await qd.storeLoad()
  // v2.0:字段兜底(渲染层镜像主进程骨架,防止导入旧配置缺字段)
  ensureV2Fields()
  // v2.1:Dock 设置兜底(含旧 showDock 布尔 → dock.mode 映射)
  const { ensureDockSettings } = await import('../stores/dockStore')
  ensureDockSettings()
  // 注意:settings 含嵌套对象(dock 等),reactive Proxy 不能过 IPC,
  // 必须深拷贝为普通对象(浅拷贝 { ...settings } 会保留嵌套 Proxy 引用)
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  // 迁移提示:主进程本启动完成过升级时 toast 告知(版本感知)
  const mv = s.appInfo.justMigratedVersion
  if (mv === '2.1') {
    toast('📦 配置已升级到 v2.1(旧配置已滚动备份为 tools.json.bak.1/2/3)', 'success', 5000)
  } else if (mv === '2.0') {
    toast('📦 配置已升级到 v2.0(旧配置已备份为 tools.json.bak)', 'success', 5000)
  }
  // v2.0:工作空间域初始化(独立 store,数据仍落同一 tools.json)
  const { initWorkspaceStore } = await import('../stores/workspaceStore')
  await initWorkspaceStore()
  await refreshIcons()
  qd.procList().then(list => { s.procs = list })
  // 主进程事件:进程列表变化(含指标)/ 日志追加 / 异常提示
  qd.onProcChanged(list => { s.procs = list })
  qd.onRunnerAlert(({ toolId, hint }) => {
    const t = toolById(toolId)
    toast(`⚠️ ${t ? t.name + ': ' : ''}${hint}`, 'error', 5000)
  })
  // 秒级时钟:驱动标题栏 / 卡片的运行时长显示
  setInterval(() => { s.procTick++ }, 1000)
  applyTheme(s.data.settings.theme)
  // v2.0:启动默认视图(home / all / last)
  applyDefaultView()
  s.loaded = true
}

// 渲染层 v2/v2.1 字段兜底(与主进程 ensureV2Skeleton + ensureV21 对齐;导入旧配置后即时补齐)
function ensureV2Fields() {
  const d = s.data
  if (!Array.isArray(d.workspaces)) d.workspaces = []
  if (!Array.isArray(d.commands)) d.commands = []
  if (!Array.isArray(d.resources)) d.resources = []
  if (!d.globalVars || typeof d.globalVars !== 'object') d.globalVars = {}
  if (!d.proxy || typeof d.proxy !== 'object') d.proxy = { profiles: [], current: null, snapshot: null }
  if (!Array.isArray(d.sessions)) d.sessions = []
  // v2.1:健康检查模板骨架(种子预设由主进程迁移负责,这里只补空数组)
  if (!Array.isArray(d.checks)) d.checks = []
  for (const t of d.tools || []) {
    if (!Array.isArray(t.checkIds)) t.checkIds = []
  }
  const DP = ['rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)', '\\bformat\\b', '\\bdel\\b', '\\bshutdown\\b', 'reg\\s+delete']
  d.settings = Object.assign({
    theme: 'dark', closeToTray: true, sortMode: 'manual', showDock: true,
    defaultView: 'home', lastView: null,
    globalShortcut: 'Control+Space',   // v2.2.0 全局呼出快捷键
    // v2.1 settings 三域
    run: { defaultCwd: '', dangerPatterns: [...DP] },
    log: { errorPatterns: ['\\berror\\b', '\\bfatal\\b', 'exception', 'traceback', '失败', '错误'], warnPatterns: ['\\bwarn', 'warning', '警告', 'deprecated'], retentionDays: 14, maxFileSizeMB: 5 },
    healthCheck: { cacheTtlSec: 300, blockOnFail: true }
  }, d.settings || {})
  // 嵌套域逐项兜底(settings 整体被旧数据覆盖时,内部可能仍缺)
  if (typeof d.settings.globalShortcut !== 'string') d.settings.globalShortcut = 'Control+Space'
  if (!d.settings.run || typeof d.settings.run !== 'object') d.settings.run = { defaultCwd: '', dangerPatterns: [...DP] }
  if (!Array.isArray(d.settings.run.dangerPatterns) || !d.settings.run.dangerPatterns.length) d.settings.run.dangerPatterns = [...DP]
  if (!('defaultCwd' in d.settings.run)) d.settings.run.defaultCwd = ''
  if (!d.settings.log || typeof d.settings.log !== 'object') d.settings.log = { errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 }
  if (!d.settings.healthCheck || typeof d.settings.healthCheck !== 'object') d.settings.healthCheck = { cacheTtlSec: 300, blockOnFail: true }
  d.version = '2.1'
}

// 启动默认页:settings.defaultView = home | all | last(上次视图)
function applyDefaultView() {
  const dv = s.data.settings.defaultView || 'home'
  if (dv === 'all') {
    s.view = { type: 'all', id: null }
  } else if (dv === 'last') {
    const lv = s.data.settings.lastView
    // 合法性校验:上次视图引用的实体必须还存在
    if (lv && lv.type && lv.type !== 'settings') {
      if (lv.type === 'cat' && !categoryById(lv.id)) { s.view = { type: 'home', id: null } }
      else s.view = { type: lv.type, id: lv.id || null }
    } else {
      s.view = { type: 'home', id: null }
    }
  } else {
    s.view = { type: 'home', id: null }
  }
}

// 视图切换:记忆「上次视图」(defaultView = 'last' 时下次启动恢复)
export function setView(view) {
  s.view = view
  s.search = ''
  // 记忆除 home / dev 占位外的视图;workspace 需校验存在性(在 openWorkspace 内 touch)
  if (['all', 'star', 'recent', 'cat', 'uncat', 'combo', 'workspace'].includes(view.type)) {
    s.data.settings.lastView = { type: view.type, id: view.id }
  }
}

/* ---------------- 智能预测:同时段(±90min,近7天)高频启动 ---------------- */
export function computePredictions() {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // 今天已经启动过工具 → 不打扰
  const startedToday = (s.data.tools || []).some(t =>
    (t.startHistory || []).some(h => new Date(h).getTime() >= todayStart.getTime()))
  if (startedToday) { s.predictions = []; return }
  const win = 90 * 60000
  const nowMin = now.getHours() * 3600000 + now.getMinutes() * 60000
  const scores = new Map()
  for (const t of s.data.tools || []) {
    let n = 0
    for (const h of (t.startHistory || []).slice(-40)) {
      const d = new Date(h)
      if (now.getTime() - d.getTime() > 7 * 86400000) continue
      const dayMin = d.getHours() * 3600000 + d.getMinutes() * 60000
      if (Math.abs(dayMin - nowMin) < win) n++
    }
    if (n >= 2) scores.set(t.id, n)
  }
  s.predictions = [...scores.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id]) => toolById(id)).filter(Boolean)
}

// 为所有「自动图标」工具请求系统图标(走主进程磁盘缓存)
export async function refreshIcons(tools = null) {
  const list = tools || s.data.tools.filter(t => isAutoIcon(t))
  await Promise.all(list.map(async t => {
    const url = await qd.getIcon(t.id, t.targetPath)
    if (url) s.icons[t.id] = url
  }))
}

export function isAutoIcon(tool) {
  return !tool.icon || tool.icon === 'auto' || tool.icon?.kind === 'auto'
}

/* ---------------- 主题 ---------------- */
export function applyTheme(theme) {
  s.data.settings.theme = theme
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
  // Win11 下切换系统材质:深色 acrylic / 浅色 mica
  qd.winSetMaterial?.(resolved === 'dark' ? 'acrylic' : 'mica')
  persist()
}

/* ---------------- 分类 ---------------- */
export const sortedCategories = computed(() =>
  [...s.data.categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
)

export function categoryById(id) {
  return s.data.categories.find(c => c.id === id) || null
}

export function countOfCategory(id) {
  return s.data.tools.filter(t => t.categoryId === id).length
}

export function addCategory({ name, emoji, color }) {
  const maxOrder = s.data.categories.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0)
  const cat = {
    id: 'cat-' + crypto.randomUUID().slice(0, 8),
    name, emoji: emoji || '📁', color: color || '#4F8CFF',
    sortOrder: maxOrder + 1
  }
  s.data.categories.push(cat)
  persist()
  return cat
}

export function updateCategory(id, patch) {
  const c = categoryById(id)
  if (c) Object.assign(c, patch)
  persist()
}

// 删除分类:其下工具移入「未分类」,不删除工具本身
export function removeCategory(id) {
  s.data.tools.forEach(t => { if (t.categoryId === id) t.categoryId = null })
  s.data.categories = s.data.categories.filter(c => c.id !== id)
  s.data.categories.forEach((c, i) => { c.sortOrder = i + 1 })
  if (s.view.type === 'cat' && s.view.id === id) setView({ type: 'all', id: null })
  persist()
}

export function reorderCategories(orderedIds) {
  orderedIds.forEach((id, i) => {
    const c = categoryById(id)
    if (c) c.sortOrder = i + 1
  })
  persist()
}

/* ---------------- 工具 ---------------- */
export function toolById(id) {
  return s.data.tools.find(t => t.id === id) || null
}

export function addTool(payload) {
  const maxOrder = s.data.tools.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0)
  const tool = {
    id: crypto.randomUUID(),
    name: payload.name,
    type: payload.type,                       // bat | cmd | lnk | exe
    targetPath: payload.targetPath,
    desc: payload.desc || '',
    categoryId: payload.categoryId || null,
    icon: payload.icon || 'auto',
    pinned: !!payload.pinned,
    runMode: payload.runMode || 'window',     // window | hidden | log | service
    runAsAdmin: !!payload.runAsAdmin,
    confirmBeforeRun: !!payload.confirmBeforeRun,
    runCount: 0,
    lastRunAt: null,
    startHistory: [],
    sortOrder: maxOrder + 1
  }
  s.data.tools.push(tool)
  if (isAutoIcon(tool)) refreshIcons([tool])
  persist()
  return tool
}

export function updateTool(id, patch) {
  const t = toolById(id)
  if (!t) return
  Object.assign(t, patch)
  if (isAutoIcon(t)) refreshIcons([t])
  persist()
}

// 删除工具条目(不删除原文件),并清理图标缓存
// v2.0:同时从所有工作空间移除该工具的引用(需求:删除工具时自动清理引用)
export async function removeTool(id) {
  s.data.tools = s.data.tools.filter(t => t.id !== id)
  delete s.icons[id]
  await qd.removeIcon?.(id) // 可选桥接(未实现时忽略)
  // 工作空间引用清理(独立 store;延迟 import 防循环依赖)
  const { cleanupToolRefs } = await import('../stores/workspaceStore')
  await cleanupToolRefs(id)
  persist()
}

export function togglePin(tool) {
  tool.pinned = !tool.pinned
  persist()
}

// 手动模式:同分类内拖拽排序
export function reorderTools(categoryId, orderedIds) {
  const base = orderedIds.length
  let order = 1
  // 先给参与排序的工具赋新顺序
  orderedIds.forEach(id => {
    const t = toolById(id)
    if (t) t.sortOrder = order++
  })
  // 不参与本次排序的其他工具排到后面(理论上是不同分类)
  s.data.tools.forEach(t => {
    if (t.categoryId === categoryId && !orderedIds.includes(t.id)) t.sortOrder = order++
  })
  persist(true)
}

/* ---------------- 视图与筛选 ---------------- */
// (v2 版本定义在 init 附近;此处保留兼容导出点)

// 相对时间:"刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 5 天前 / 32 天前"
export function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0 || isNaN(diff)) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const day = Math.floor(h / 24)
  if (day === 1) return '昨天'
  if (day < 30) return `${day} 天前`
  return `${Math.floor(day / 30)} 个月前`
}

// 问候语(按时段)
export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function toggleCollapse(catId) {
  s.collapsed.has(catId) ? s.collapsed.delete(catId) : s.collapsed.add(catId)
}

export function sortedTools(list) {
  const mode = s.data.settings.sortMode
  const arr = [...list]
  if (mode === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  else if (mode === 'frequent') arr.sort((a, b) => (b.runCount || 0) - (a.runCount || 0) || String(b.lastRunAt || '').localeCompare(String(a.lastRunAt || '')))
  else arr.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  return arr
}

// 搜索过滤(名称 / 备注 / 分类名 / 拼音首字母)
export function matchSearch(tool, q) {
  if (!q) return true
  const kw = q.trim().toLowerCase()
  if (!kw) return true
  const cat = tool.categoryId ? categoryById(tool.categoryId) : null
  const fields = [
    tool.name,
    tool.desc || '',
    cat ? cat.name : '未分类',
    initialism(tool.name),
    initialism(tool.desc || '')
  ]
  return fields.some(f => f.toLowerCase().includes(kw))
}

/* ---------------- 最近使用 / 智能统计 ---------------- */
// 最近使用:按 lastRunAt 降序(含历史工具)
export const recentTools = computed(() =>
  sortedTools(s.data.tools.filter(t => t.lastRunAt))
    .sort((a, b) => String(b.lastRunAt).localeCompare(String(a.lastRunAt)))
    .slice(0, 30)
)

// 今天启动次数
export const todayRunCount = computed(() => {
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  let n = 0
  for (const t of s.data.tools) {
    for (const h of (t.startHistory || [])) {
      if (new Date(h).getTime() >= todayStart) n++
    }
  }
  return n
})

// 「继续昨天的工作」:昨天启动过的工具,按次数取 3
export const continueTools = computed(() => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayEnd = dayStart + 86400000
  const scores = new Map()
  for (const t of s.data.tools) {
    const n = (t.startHistory || []).filter(h => {
      const ts = new Date(h).getTime(); return ts >= dayStart && ts < dayEnd
    }).length
    if (n > 0) scores.set(t.id, n)
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id]) => toolById(id)).filter(Boolean)
})

// 本周使用报告:Top N(按启动历史统计)
export const weeklyStats = computed(() => {
  const weekAgo = Date.now() - 7 * 86400000
  return s.data.tools
    .map(t => ({ tool: t, n: (t.startHistory || []).filter(h => new Date(h).getTime() > weekAgo).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
})

// 沉睡工具:用过后超过 30 天未启动
export const sleepyTools = computed(() => {
  const limit = Date.now() - 30 * 86400000
  return s.data.tools.filter(t =>
    (t.runCount || 0) > 0 && t.lastRunAt && new Date(t.lastRunAt).getTime() < limit)
})

/* ---------------- 工具组合(一键工作环境) ---------------- */
export const sortedCombos = computed(() =>
  [...(s.data.combos || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
)

export function comboById(id) {
  return (s.data.combos || []).find(c => c.id === id) || null
}

export function addCombo({ name, emoji, toolIds }) {
  const maxOrder = (s.data.combos || []).reduce((m, c) => Math.max(m, c.sortOrder || 0), 0)
  const combo = {
    id: 'combo-' + crypto.randomUUID().slice(0, 8),
    name, emoji: emoji || '⚡',
    toolIds: [...toolIds],
    sortOrder: maxOrder + 1
  }
  s.data.combos.push(combo)
  persist()
  return combo
}

export function updateCombo(id, patch) {
  const c = comboById(id)
  if (c) Object.assign(c, patch)
  persist()
}

export function removeCombo(id) {
  s.data.combos = (s.data.combos || []).filter(c => c.id !== id)
  if (s.view.type === 'combo' && s.view.id === id) setView({ type: 'all', id: null })
  persist()
}

// 一键启动组合:串行启动全部工具(间隔 400ms,避免瞬时资源冲击)
export async function runCombo(combo) {
  const tools = (combo.toolIds || []).map(id => toolById(id)).filter(Boolean)
  if (!tools.length) { toast('组合里还没有工具', 'error'); return }
  toast(`⚡ 正在启动组合「${combo.name}」(0/${tools.length})`, 'info')
  let okCount = 0
  for (let i = 0; i < tools.length; i++) {
    const r = await doRunSilent(tools[i])
    if (r && r.ok) okCount++
    if (i < tools.length - 1) await new Promise(res => setTimeout(res, 400))
  }
  toast(`⚡ 组合「${combo.name}」启动完成(${okCount}/${tools.length})`, 'success')
}

// 组合内部启动:跳过单个工具的二次确认(点击一键启动即为明确意图,避免连续弹 N 次框)
function doRunSilent(tool) {
  return doRun(tool)
}

// 当前视图 → 分组数据 [{ key, title, emoji, categoryId, tools, collapsible }]
export const viewGroups = computed(() => {
  const q = s.search
  const groups = []
  if (s.view.type === 'all') {
    for (const cat of sortedCategories.value) {
      const tools = sortedTools(s.data.tools.filter(t => t.categoryId === cat.id).filter(t => matchSearch(t, q)))
      if (q && tools.length === 0) continue // 搜索时空组隐藏
      groups.push({ key: cat.id, title: cat.name, emoji: cat.emoji, color: cat.color, categoryId: cat.id, tools, collapsible: true })
    }
    const uncat = sortedTools(s.data.tools.filter(t => !t.categoryId).filter(t => matchSearch(t, q)))
    if (!(q && uncat.length === 0)) {
      groups.push({ key: '__uncat', title: '未分类', emoji: '📥', color: null, categoryId: null, tools: uncat, collapsible: true })
    }
  } else if (s.view.type === 'recent') {
    // 最近使用:按 lastRunAt 平铺
    groups.push({
      key: '__recent', title: '最近使用', emoji: '🕘', tools: recentTools.value, collapsible: false
    })
  } else if (s.view.type === 'combo') {
    // 组合视图:按 combo 定义的顺序展示
    const combo = comboById(s.view.id)
    const tools = (combo?.toolIds || []).map(id => toolById(id)).filter(Boolean).filter(t => matchSearch(t, q))
    groups.push({ key: '__combo', title: combo?.name || '组合', emoji: combo?.emoji || '⚡', tools, collapsible: false })
  } else if (s.view.type === 'star') {
    // 常用视图:置顶优先 + 运行次数 Top 12(去重)
    const pinned = sortedTools(s.data.tools.filter(t => t.pinned))
    const rest = sortedTools(s.data.tools.filter(t => !t.pinned))
    groups.push({ key: '__star', title: '常用', emoji: '⭐', tools: [...pinned, ...rest].slice(0, 12), collapsible: false })
  } else if (s.view.type === 'cat') {
    const cat = categoryById(s.view.id)
    const tools = sortedTools(s.data.tools.filter(t => t.categoryId === s.view.id).filter(t => matchSearch(t, q)))
    groups.push({ key: cat?.id || 'cat', title: cat?.name || '分类', emoji: cat?.emoji || '📁', color: cat?.color, categoryId: s.view.id, tools, collapsible: false })
  } else if (s.view.type === 'uncat') {
    const tools = sortedTools(s.data.tools.filter(t => !t.categoryId).filter(t => matchSearch(t, q)))
    groups.push({ key: '__uncat', title: '未分类', emoji: '📥', tools, collapsible: false })
  }
  return groups
})

export const visibleCount = computed(() => viewGroups.value.reduce((n, g) => n + g.tools.length, 0))

// 当前视图标题
export const viewTitle = computed(() => {
  if (s.view.type === 'home') return '首页'
  if (s.view.type === 'all') return '全部工具'
  if (s.view.type === 'star') return '⭐ 常用'
  if (s.view.type === 'recent') return '🕘 最近使用'
  if (s.view.type === 'uncat') return '未分类'
  if (s.view.type === 'settings') return '设置'
  if (s.view.type === 'workspace') return '🎯 工作空间'
  if (s.view.type === 'dev') return '开发中'
  if (s.view.type === 'combo') {
    const c = comboById(s.view.id)
    return c ? `${c.emoji} ${c.name}` : '组合'
  }
  const cat = categoryById(s.view.id)
  return cat ? `${cat.emoji} ${cat.name}` : '分类'
})

// 「全部工具」总数
export const totalCount = computed(() => s.data.tools.length)
export const pinnedCount = computed(() => s.data.tools.filter(t => t.pinned).length)
export const uncatCount = computed(() => s.data.tools.filter(t => !t.categoryId).length)

/* ---------------- 运行 ---------------- */
export function isRunning(toolId) {
  return s.procs.some(p => p.toolId === toolId)
}

// 以指定(或默认)启动配置运行:走主进程 launcher:run
// 兼容回落(某字段空/配置缺失 → 工具顶层旧字段)由主进程权威执行
export async function doRun(tool, configId = null) {
  // 健康检查:目标文件已不存在时给出修复入口,而不是让 runner 抛出晦涩错误
  const exists = await qd.fsExists(tool.targetPath)
  if (!exists) {
    const open = await confirmBox({
      title: '工具健康检查',
      message: `「${tool.name}」的目标文件不存在,可能已被移动、重命名或删除。`,
      detail: tool.targetPath,
      confirmText: '打开所在目录'
    })
    if (open) qd.showInFolder(tool.targetPath)
    return { ok: false, message: '目标文件不存在' }
  }
  const plain = JSON.parse(JSON.stringify(tool))
  const r = await qd.launcherRun({ tool: plain, configId })
  if (r.ok) {
    // 本地同步统计并持久化;启动历史供「最近使用/使用报告/智能预测」使用
    const nowIso = new Date().toISOString().slice(0, 19)
    tool.runCount = (tool.runCount || 0) + 1
    tool.lastRunAt = nowIso
    tool.startHistory = [nowIso, ...(tool.startHistory || [])].slice(0, 30)
    persist()
    toast(r.message || '已启动', 'success')
    computePredictions()   // 启动后刷新预测(今天启动过就不再打扰)
    // 日志模式:自动打开日志面板实时查看输出
    if (r.autoOpenLog) {
      s.logPanel.open = true
      s.logPanel.toolId = tool.id
    }
    // v2.1:检查有警告但放行时提示(blockOnFail=false 场景)
    if (r.warnings && r.warnings.length) {
      toast(`⚠ 环境检查 ${r.warnings.length} 项未过(已按设置放行):${r.warnings[0]}`, 'info', 5000)
    }
  } else if (r.blocked) {
    // v2.1:健康检查拦截 → 弹检查面板(可「跳过检查强制启动」)
    s.healthPanel.open = true
    s.healthPanel.toolId = tool.id
    s.healthPanel.configId = configId
    s.healthPanel.results = r.results || []
  } else {
    toast(r.message || '启动失败', 'error')
  }
  return r
}

// 运行入口:处理「运行前二次确认」
// 返回 doRun 的结果(组合/工作空间批量启动按 ok 计数)
export async function askRun(tool, configId = null) {
  if (tool.confirmBeforeRun) {
    const yes = await confirmBox({
      title: '运行确认',
      message: `确定要运行「${tool.name}」吗?`,
      detail: tool.targetPath,
      confirmText: '运行'
    })
    if (!yes) return { ok: false, message: '已取消' }
  }
  return doRun(tool, configId)
}

/* ---------------- 进程 ---------------- */
export async function killProc(pid) {
  await qd.killPid(pid)
}

// 结束某工具的全部运行中进程
export async function killByTool(toolId) {
  await qd.killByTool(toolId)
}

/* ---------------- Toast ---------------- */
export function toast(message, type = 'info', duration = 2600) {
  const id = crypto.randomUUID()
  s.toasts.push({ id, message, type })
  setTimeout(() => {
    const i = s.toasts.findIndex(t => t.id === id)
    if (i > -1) s.toasts.splice(i, 1)
  }, duration)
}

/* ---------------- 通用确认框 ---------------- */
export function confirmBox(options) {
  return new Promise(resolve => {
    s.confirmState = { open: true, options, resolve }
  })
}

/* ---------------- 右键菜单 ---------------- */
export function openContextMenu(e, items) {
  e.preventDefault()
  e.stopPropagation()
  const menuW = 176
  const x = Math.min(e.clientX, window.innerWidth - menuW - 8)
  const y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 16)
  s.ctxMenu = { open: true, x, y, items }
}

export function closeContextMenu() {
  s.ctxMenu.open = false
}
