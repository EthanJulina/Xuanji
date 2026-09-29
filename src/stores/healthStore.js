// ============================================================
// 玄机 - 环境健康检查 store v2.1(渲染层)
// 模板列表镜像(healthChecks)+ 手动运行 + 工具挂载管理
// ============================================================
import { reactive, ref } from 'vue'
import { s, persist, toast } from '../composables/store'

const qd = window.qd

// 模板映射:id → 模板对象(供面板/编辑区展示)
export const healthChecksById = ref({})

// 模板列表(响应式镜像;刷新走 reloadChecks)
export const healthChecks = reactive({ list: [] })

export async function reloadChecks() {
  try {
    healthChecks.list = await qd.healthChecks() || []
  } catch (_) {
    healthChecks.list = []
  }
  const map = {}
  for (const c of healthChecks.list) map[c.id] = c
  healthChecksById.value = map
}

// 手动跑某工具挂载的检查(面板 / ToolModal 用)
export async function runToolChecks(toolId, force = false) {
  const tool = s.data.tools.find(t => t.id === toolId)
  const ids = (tool && Array.isArray(tool.checkIds)) ? tool.checkIds : []
  if (!ids.length) return []
  return qd.healthRun({ checkIds: ids, force })
}

// 工具挂载/摘除检查模板
export async function toggleToolCheck(toolId, checkId) {
  const tool = s.data.tools.find(t => t.id === toolId)
  if (!tool) return
  if (!Array.isArray(tool.checkIds)) tool.checkIds = []
  const i = tool.checkIds.indexOf(checkId)
  if (i >= 0) tool.checkIds.splice(i, 1)
  else tool.checkIds.push(checkId)
  persist()
}

export async function createCheck(payload) {
  const chk = await qd.healthCreate(payload)
  await reloadChecks()
  return chk
}

export async function updateCheck(id, patch) {
  const r = await qd.healthUpdate(id, patch)
  if (r && r.error) { toast(r.error, 'error'); return null }
  await reloadChecks()
  return r.check
}

export async function deleteCheck(id) {
  await qd.healthDelete(id)
  // 本地同步:工具 checkIds 移除引用
  for (const t of s.data.tools) {
    if (Array.isArray(t.checkIds)) t.checkIds = t.checkIds.filter(x => x !== id)
  }
  await reloadChecks()
  persist()
}
