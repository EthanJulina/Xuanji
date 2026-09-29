// ============================================================
// 玄机 - 命令库域 store v2.1(渲染层)
// 职责:命令 CRUD 镜像 / 变量提取与渲染(优先级 workspace > globalVars > ask)
//       / varMemory 记忆 / 运行弹窗打开 / 运行与复制动作
// 数据边界:commands 实体镜像在 s.data.commands(与主进程同源,写走 command: IPC)
// 注意:跨 IPC 一律深拷贝(reactive Proxy 不能过结构化克隆)
// ============================================================
import { reactive, computed } from 'vue'
import { s, toast, persist } from '../composables/store'
import { workspaceById } from './workspaceStore'

const qd = window.qd

/* ---------------- 变量语法:{{key}} ---------------- */
const VAR_RE = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g

// 提取模板中的变量 key(去重,按出现顺序)
export function extractVars(template) {
  const out = []
  const re = new RegExp(VAR_RE.source, 'g')
  let m
  while ((m = re.exec(String(template || ''))) !== null) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/* ---------------- 变量来源解析 ----------------
 * 优先级:当前工作空间 vars > globalVars > ask(弹窗询问)
 * 不在工作空间视图时 workspace 来源不可用 → 回落 ask
 * 返回:key → { value, source } ;source = workspace | global | ask
 */
export function resolveSources(template) {
  const keys = extractVars(template)
  // 当前工作空间(仅工作空间视图下生效)
  const curWs = (s.view.type === 'workspace' && s.view.id) ? workspaceById(s.view.id) : null
  const wsVars = (curWs && curWs.vars && typeof curWs.vars === 'object') ? curWs.vars : {}
  const globals = (s.data.globalVars && typeof s.data.globalVars === 'object') ? s.data.globalVars : {}
  const map = {}
  for (const k of keys) {
    if (k in wsVars && String(wsVars[k]).trim() !== '') {
      map[k] = { value: String(wsVars[k]), source: 'workspace' }
    } else if (k in globals && String(globals[k]).trim() !== '') {
      map[k] = { value: String(globals[k]), source: 'global' }
    } else {
      map[k] = { value: '', source: 'ask' }
    }
  }
  return map
}

/* ---------------- 渲染 ---------------- */
// values: { key: string };missing = 仍为空的 {{var}} 列表
export function renderTemplate(template, values) {
  const val = values || {}
  const missing = []
  const text = String(template || '').replace(VAR_RE, (_, k) => {
    const v = val[k]
    if (v === undefined || v === null || String(v) === '') { missing.push(k); return `{{${k}}}` }
    return String(v)
  })
  return { text, missing }
}

// 实时预览用:ask 变量用「高亮占位」渲染(填了替换,没填保持原样并收集)
export function previewRender(template, askValues) {
  const src = resolveSources(template)
  const merged = {}
  for (const [k, info] of Object.entries(src)) {
    if (info.source === 'ask') merged[k] = (askValues && askValues[k]) || ''
    else merged[k] = info.value
  }
  return renderTemplate(template, merged)
}

/* ---------------- 命令 CRUD(镜像 + 持久化) ---------------- */
export function commandById(id) {
  return (s.data.commands || []).find(c => c.id === id) || null
}

export const sortedCommands = computed(() =>
  [...(s.data.commands || [])].sort((a, b) => {
    if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1     // 收藏优先
    return String(b.lastRunAt || b.createdAt || '').localeCompare(String(a.lastRunAt || a.createdAt || ''))
  })
)

export async function createCommand(payload) {
  const cmd = await qd.commandCreate(JSON.parse(JSON.stringify(payload)))
  s.data.commands.push(cmd)
  persist()
  return cmd
}

export async function updateCommand(id, patch) {
  const local = commandById(id)
  if (local) Object.assign(local, patch)
  const r = await qd.commandUpdate(id, JSON.parse(JSON.stringify(patch)))
  return r
}

export async function removeCommand(id) {
  await qd.commandDelete(id)
  s.data.commands = s.data.commands.filter(c => c.id !== id)
  persist()
}

/* ---------------- varMemory:ask 填写值记忆(按命令 id + 变量 key) ---------------- */
export async function rememberVars(cmd, values) {
  if (!cmd) return
  const mem = { ...(cmd.varMemory || {}) }
  let changed = false
  for (const [k, v] of Object.entries(values || {})) {
    if (v !== '' && v !== undefined && v !== null && mem[k] !== v) { mem[k] = v; changed = true }
  }
  if (changed) await updateCommand(cmd.id, { varMemory: mem })
}

/* ---------------- 动作 ---------------- */
// 打开运行弹窗(Ctrl+K Enter / 命令库「运行」按钮共用入口)
export function openCommandRun(cmd) {
  if (!cmd) return
  s.commandRun.open = true
  s.commandRun.cmdId = cmd.id
}

// 复制:优先渲染好的命令(变量齐全时),否则复制模板原文
export async function copyCommand(cmd) {
  const src = resolveSources(cmd.template)
  const askLeft = Object.entries(src).filter(([, i]) => i.source === 'ask')
  if (!askLeft.length) {
    const { text } = renderTemplate(cmd.template, Object.fromEntries(Object.entries(src).map(([k, i]) => [k, i.value])))
    await qd.copyText(text)
    toast('已复制渲染后的命令', 'success')
  } else {
    await qd.copyText(cmd.template || '')
    toast(`已复制模板原文(${askLeft.length} 个变量需运行时填写)`, 'info')
  }
}

// 运行(弹窗确认后调用):写 varMemory → command:run
export async function runCommand(cmd, askValues, confirmedDanger) {
  const src = resolveSources(cmd.template)
  const merged = {}
  for (const [k, info] of Object.entries(src)) {
    merged[k] = info.source === 'ask' ? (askValues?.[k] ?? '') : info.value
  }
  const { text, missing } = renderTemplate(cmd.template, merged)
  if (missing.length) {
    toast(`还有 ${missing.length} 个变量未填写:${missing.join(', ')}`, 'error')
    return { ok: false }
  }
  const cwd = (s.data.settings.run?.defaultCwd || '').trim()
  const r = await qd.commandRun({
    id: cmd.id,
    name: cmd.name,
    rendered: text,
    cwd,
    confirmedDanger: !!confirmedDanger
  })
  if (r.ok) {
    await rememberVars(cmd, askValues || {})
    toast(`命令已开始运行,输出见日志中心`, 'success')
  } else if (r.error === 'danger-blocked') {
    toast(r.message || '危险命令被阻止', 'error')
  } else {
    toast(r.error || '命令运行失败', 'error')
  }
  return r
}
