// ============================================================
// 玄机 - 工作空间域 store(渲染层)
// 职责:工作空间 CRUD / 勾选态 / 批量启动(500ms 间隔)
// 边界:只管 workspaces 实体;工具数据一律通过主 store 的
//       toolById 引用,不复制(需求:引用而非拷贝)
// IPC:全部走 workspace: 前缀,不与其他域穿透
// ============================================================
import { reactive, computed } from 'vue'
import { s, toolById, askRun, toast, persist, setView } from '../composables/store'

const qd = window.qd

/* ---------------- 域内状态 ---------------- */
export const ws = reactive({
  list: [],                    // 服务端 workspaces 数组(镜像)
  // 准备面板勾选态:workspaceId → Set<toolId>
  // 视图切换/空间切换时重置(默认全勾选)
  checked: {},
  launching: false             // 「启动环境」进行中(防重复点击)
})

/* ---------------- 初始化 ---------------- */
export async function initWorkspaceStore() {
  try {
    ws.list = await qd.wsList()
  } catch (_) {
    ws.list = []
  }
}

/* ---------------- 派生 ---------------- */
export const sortedWorkspaces = computed(() =>
  [...ws.list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
)

export function workspaceById(id) {
  return ws.list.find(w => w.id === id) || null
}

// 最近打开的工作空间(首页用;按 lastOpenedAt 降序)
export const recentWorkspaces = computed(() =>
  [...ws.list]
    .filter(w => w.lastOpenedAt)
    .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
    .slice(0, 4)
)

// 某空间的工具对象列表(过滤掉已删除的引用)
export function workspaceTools(workspace) {
  return (workspace.toolIds || []).map(id => toolById(id)).filter(Boolean)
}

/* ---------------- CRUD ---------------- */
export async function createWorkspace({ name, emoji, color }) {
  const created = await qd.wsCreate({ name, emoji, color })
  ws.list.push(created)
  return created
}

export async function updateWorkspace(id, patch) {
  const local = workspaceById(id)
  if (local) Object.assign(local, patch)
  // 防御性深拷贝:patch 可能携带 reactive 引用,Proxy 无法通过 IPC 结构化克隆
  return qd.wsUpdate(id, JSON.parse(JSON.stringify(patch)))
}

export async function removeWorkspace(id) {
  await qd.wsDelete(id)
  ws.list = ws.list.filter(w => w.id !== id)
  delete ws.checked[id]
  // 若正停留在被删空间 → 回首页
  if (s.view.type === 'workspace' && s.view.id === id) setView({ type: 'home', id: null })
}

// 进入工作空间视图:记录打开时间 + 重置勾选态为全选
export async function openWorkspace(id) {
  const w = workspaceById(id)
  if (!w) return
  setView({ type: 'workspace', id })
  resetChecked(id)
  const r = await qd.wsTouch(id)
  if (r && r.lastOpenedAt) w.lastOpenedAt = r.lastOpenedAt
}

// 勾选态:默认全部勾选(需求 7.1)
function resetChecked(workspaceId) {
  const w = workspaceById(workspaceId)
  ws.checked[workspaceId] = new Set((w?.toolIds || []))
}

export function isChecked(workspaceId, toolId) {
  const set = ws.checked[workspaceId]
  return set ? set.has(toolId) : true
}

export function toggleChecked(workspaceId, toolId) {
  if (!ws.checked[workspaceId]) resetChecked(workspaceId)
  const set = ws.checked[workspaceId]
  set.has(toolId) ? set.delete(toolId) : set.add(toolId)
}

/* ---------------- 成员管理 ---------------- */
// 添加工具(多选);保持引用顺序 = 添加顺序
export async function addToolsToWorkspace(workspaceId, toolIds) {
  const w = workspaceById(workspaceId)
  if (!w) return
  const merged = [...new Set([...(w.toolIds || []), ...toolIds])]
  await updateWorkspace(workspaceId, { toolIds: merged })
  // 新加的工具默认勾选
  if (ws.checked[workspaceId]) toolIds.forEach(id => ws.checked[workspaceId].add(id))
}

// 移除引用(不删除工具本身)
export async function removeToolFromWorkspace(workspaceId, toolId) {
  const w = workspaceById(workspaceId)
  if (!w) return
  await updateWorkspace(workspaceId, { toolIds: (w.toolIds || []).filter(id => id !== toolId) })
  ws.checked[workspaceId]?.delete(toolId)
}

// 拖拽排序:重排 toolIds
export async function reorderWorkspaceTools(workspaceId, orderedIds) {
  await updateWorkspace(workspaceId, { toolIds: orderedIds })
}

/* ---------------- 项目目录 ---------------- */
export async function addWorkspacePath(workspaceId, name, dirPath) {
  const w = workspaceById(workspaceId)
  if (!w) return
  const paths = [...(w.paths || []), {
    id: 'p-' + crypto.randomUUID().slice(0, 8),
    name: name || dirPath.split(/[\\/]/).pop() || '目录',
    path: dirPath
  }]
  await updateWorkspace(workspaceId, { paths })
}

export async function removeWorkspacePath(workspaceId, pathId) {
  const w = workspaceById(workspaceId)
  if (!w) return
  await updateWorkspace(workspaceId, { paths: (w.paths || []).filter(p => p.id !== pathId) })
}

/* ---------------- 变量(P1 命令模板数据源) ---------------- */
export async function setWorkspaceVar(workspaceId, key, value) {
  const w = workspaceById(workspaceId)
  if (!w) return
  const vars = { ...(w.vars || {}) }
  if (value === '' || value === null || value === undefined) delete vars[key]
  else vars[key] = value
  await updateWorkspace(workspaceId, { vars })
}

/* ---------------- 批量启动(准备面板核心动作) ---------------- */
// 勾选后点「启动环境」:按 toolIds 顺序串行拉起,间隔 500ms
// 各工具自身的二次确认 / 管理员权限照常生效(askRun 完整链路)
// 「启动环境」是显式动作;进入工作空间绝不自动拉起任何工具
export async function launchEnvironment(workspaceId) {
  if (ws.launching) { toast('正在启动中,请稍候…', 'info'); return }
  const w = workspaceById(workspaceId)
  if (!w) return
  if (!ws.checked[workspaceId]) resetChecked(workspaceId)
  const tools = workspaceTools(w).filter(t => ws.checked[workspaceId].has(t.id))
  if (!tools.length) { toast('请先勾选要启动的工具', 'error'); return }

  ws.launching = true
  toast(`🚀 正在启动「${w.name}」环境(0/${tools.length})`, 'info')
  let okCount = 0
  try {
    for (let i = 0; i < tools.length; i++) {
      const r = await askRun(tools[i])        // 二次确认 / 管理员照常生效
      if (r && r.ok !== false) okCount++      // askRun 取消时返回 undefined,不计入
      if (i < tools.length - 1) await new Promise(res => setTimeout(res, 500))
    }
    toast(`🚀 「${w.name}」环境启动完成(${okCount}/${tools.length})`, 'success')
  } finally {
    ws.launching = false
  }
}

/* ---------------- 删除工具后的引用清理 ---------------- */
// 主 store.removeTool 之后调用:本地 ws.list 同步移除引用 + 主进程落盘
export async function cleanupToolRefs(toolId) {
  let affected = 0
  for (const w of ws.list) {
    if ((w.toolIds || []).includes(toolId)) {
      w.toolIds = w.toolIds.filter(id => id !== toolId)
      affected++
    }
  }
  if (affected > 0) await qd.wsRemoveToolRef(toolId)
}
