<script setup>
// 工作空间视图(核心新页面)
// 结构:顶部(emoji+名称+上次打开+「启动环境」主按钮)
//      → 准备面板(全部工具,勾选框默认全勾,批量启动)
//      → 项目目录区(paths,打开文件夹/增删)
//      → 变量区(vars,为 P1 命令模板准备)
// 交互红线:进入空间绝不自动拉起工具;「启动环境」为显式动作
import { ref, computed } from 'vue'
import {
  ws, workspaceById, workspaceTools, isChecked, toggleChecked,
  launchEnvironment, removeToolFromWorkspace, reorderWorkspaceTools,
  addWorkspacePath, removeWorkspacePath, setWorkspaceVar
} from '../stores/workspaceStore'
import { activeLaunchConfigName } from '../stores/launchConfigStore'
import { s, toolById, relativeTime, toast, persist, openContextMenu, isRunning } from '../composables/store'
import ToolIcon from './ToolIcon.vue'
import KvEditor from './KvEditor.vue'

const qd = window.qd

const workspace = computed(() => workspaceById(s.view.id))
const tools = computed(() => workspace.value ? workspaceTools(workspace.value) : [])
const checkedCount = computed(() => {
  if (!workspace.value) return 0
  if (!ws.checked[workspace.value.id]) return tools.value.length   // 默认全勾
  return tools.value.filter(t => ws.checked[workspace.value.id].has(t.id)).length
})

// 新目录表单
const newDirName = ref('')
const newDirPath = ref('')

async function pickDir() {
  const p = await qd.pickDirectory()
  if (p) {
    newDirPath.value = p
    if (!newDirName.value) newDirName.value = p.split(/[\\/]/).pop() || '目录'
  }
}

async function addPath() {
  if (!newDirPath.value.trim()) { toast('请先选择目录', 'error'); return }
  await addWorkspacePath(s.view.id, newDirName.value.trim(), newDirPath.value.trim())
  persist()
  newDirName.value = ''
  newDirPath.value = ''
  toast('项目目录已添加', 'success')
}

async function delPath(p) {
  await removeWorkspacePath(s.view.id, p.id)
  persist()
}

function openDir(p) {
  qd.showInFolder(p.path)
}

// 变量编辑(KvEditor v-model → 逐键写入)
const varsModel = ref({})
function syncVars() {
  varsModel.value = { ...(workspace.value?.vars || {}) }
}
syncVars()

async function onVarsChange(obj) {
  // 对比差异逐键更新(避免整包覆盖竞态)
  const old = workspace.value?.vars || {}
  for (const k of new Set([...Object.keys(old), ...Object.keys(obj)])) {
    if ((old[k] || '') !== (obj[k] || '')) {
      await setWorkspaceVar(s.view.id, k, obj[k] ?? '')
    }
  }
  persist()
}

// 工具行右键菜单:以默认配置运行 / 移除引用 / 查看日志
function rowMenu(e, tool) {
  openContextMenu(e, [
    { icon: '▶️', label: '运行', action: () => { s.askRunRef = tool } },
    { icon: '📋', label: '查看日志', action: () => { s.logPanel.open = true; s.logPanel.toolId = tool.id } },
    { icon: '✏️', label: '编辑工具', action: () => { s.toolModal.open = true; s.toolModal.editId = tool.id } },
    { icon: '🗑', label: '从空间移除', danger: true, action: async () => {
      await removeToolFromWorkspace(s.view.id, tool.id)
      persist()
      toast(`已从空间移除「${tool.name}」(工具库不受影响)`, 'success')
    } }
  ])
}

// 拖拽排序(空间内 toolIds 顺序)
function onDragStart(e, toolId) {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/qd-ws-tool', toolId)
}
function onDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}
async function onDrop(e, overToolId) {
  const dragId = e.dataTransfer.getData('text/qd-ws-tool')
  if (!dragId || dragId === overToolId || !workspace.value) return
  const ids = [...(workspace.value.toolIds || [])]
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(overToolId)
  if (from === -1 || to === -1) return
  ids.splice(to, 0, ids.splice(from, 1)[0])
  await reorderWorkspaceTools(s.view.id, ids)
  persist()
}
</script>

<template>
  <div v-if="workspace" class="ws-view scroll-area">
    <!-- 顶部:身份 + 主操作 -->
    <header class="ws-head enter-item">
      <div class="ws-id">
        <span class="ws-emoji" :style="{ background: (workspace.color || '#4F8CFF') + '26' }">{{ workspace.emoji || '🎯' }}</span>
        <div class="ws-title-block">
          <h2 class="ws-name">{{ workspace.name }}</h2>
          <span class="ws-last">上次打开:{{ workspace.lastOpenedAt ? relativeTime(workspace.lastOpenedAt) : '从未' }}</span>
        </div>
      </div>
      <div class="ws-head-actions">
        <button class="btn" @click="s.wsModal.open = true; s.wsModal.editId = workspace.id">✏️ 编辑</button>
        <button class="btn btn-primary launch-btn" :disabled="ws.launching"
                title="按顺序启动勾选的工具(间隔 0.5s)"
                @click="launchEnvironment(workspace.id)">
          <span v-if="ws.launching">启动中…</span>
          <span v-else>🚀 启动环境({{ checkedCount }}/{{ tools.length }})</span>
        </button>
      </div>
    </header>

    <!-- 准备面板(核心) -->
    <section class="ws-card enter-item" style="--i:1">
      <div class="ws-card-head">
        <h4 class="ws-card-title">🧰 准备面板</h4>
        <div class="ws-card-meta">
          <span class="meta-chip">勾选 {{ checkedCount }} / {{ tools.length }}</span>
          <button class="btn btn-sm" @click="s.wsAddTools.open = true; s.wsAddTools.workspaceId = workspace.id">＋ 添加工具</button>
        </div>
      </div>

      <div v-if="tools.length" class="ws-tool-list">
        <div v-for="tool in tools" :key="tool.id"
             class="ws-tool-row" draggable="true"
             @dragstart="onDragStart($event, tool.id)"
             @dragover="onDragOver"
             @drop="onDrop($event, tool.id)"
             @contextmenu="rowMenu($event, tool)">
          <button class="ws-check" :class="{ on: isChecked(workspace.id, tool.id), running: isRunning(tool.id) }"
                  :title="isChecked(workspace.id, tool.id) ? '取消勾选' : '勾选启动'"
                  @click="toggleChecked(workspace.id, tool.id)">
            <span class="chk-mark">{{ isChecked(workspace.id, tool.id) ? '✓' : '' }}</span>
          </button>
          <ToolIcon :tool="tool" :size="30" />
          <div class="ws-tool-info">
            <div class="ws-tool-name">{{ tool.name }}<span v-if="isRunning(tool.id)" class="run-dot"></span></div>
            <div class="ws-tool-sub">{{ activeLaunchConfigName(tool) }}</div>
          </div>
          <span class="ws-tool-type">{{ tool.type.toUpperCase() }}</span>
        </div>
      </div>
      <div v-else class="ws-empty">
        <p>空间里还没有工具</p>
        <button class="btn btn-primary" @click="s.wsAddTools.open = true; s.wsAddTools.workspaceId = workspace.id">＋ 添加工具</button>
      </div>
      <p class="ws-hint">💡 勾选后点「启动环境」按顺序批量启动(间隔 0.5s);各工具的二次确认与管理员权限照常生效</p>
    </section>

    <!-- 项目目录区 -->
    <section class="ws-card enter-item" style="--i:2">
      <div class="ws-card-head">
        <h4 class="ws-card-title">📁 项目目录</h4>
        <span class="ws-card-meta meta-chip" v-if="workspace.paths?.length">{{ workspace.paths.length }} 个</span>
      </div>
      <div v-if="workspace.paths?.length" class="ws-path-list">
        <div v-for="p in workspace.paths" :key="p.id" class="ws-path-row">
          <span class="path-name">{{ p.name }}</span>
          <span class="path-val mono ellipsis" :title="p.path">{{ p.path }}</span>
          <button class="btn btn-sm" @click="openDir(p)">📂 打开</button>
          <button class="kv-del" title="删除" @click="delPath(p)">✕</button>
        </div>
      </div>
      <div v-else class="ws-mini-empty">还没有项目目录,把报告目录、Payload 目录挂进来</div>
      <div class="ws-add-path">
        <input v-model="newDirName" class="input" placeholder="目录名称(如:报告目录)" maxlength="20" />
        <input v-model="newDirPath" class="input path-input" placeholder="选择或粘贴目录路径" readonly @click="pickDir" />
        <button class="btn" @click="pickDir">浏览…</button>
        <button class="btn btn-primary" @click="addPath">添加</button>
      </div>
    </section>

    <!-- 变量区 -->
    <section class="ws-card enter-item" style="--i:3">
      <div class="ws-card-head">
        <h4 class="ws-card-title">🔤 空间变量</h4>
        <span class="ws-card-meta meta-chip">为命令模板准备(P1)</span>
      </div>
      <KvEditor v-model="varsModel"
                key-placeholder="变量名(如 target)"
                value-placeholder="值(如 target.com)"
                @update:modelValue="onVarsChange" />
      <p class="ws-hint">命令模板中的 <code>{{ '\{\{target\}\}' }}</code> 将优先取这里的值(P1 实装后生效)</p>
    </section>
  </div>

  <!-- 空间不存在(已被删除) -->
  <div v-else class="ws-gone">
    <div class="empty-icon">🎯</div>
    <h3>工作空间不存在</h3>
    <p>它可能已被删除</p>
    <button class="btn btn-primary" @click="s.view = { type: 'home', id: null }">回到首页</button>
  </div>
</template>

<style scoped>
.ws-view {
  flex: 1;
  overflow-y: auto;
  padding: 6px 24px 96px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- 顶部 ---- */
.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0 4px;
}
.ws-id { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ws-emoji {
  width: 52px; height: 52px;
  border-radius: 14px;
  display: grid; place-items: center;
  font-size: 26px;
  box-shadow: inset 0 0 0 1px var(--divider);
  flex-shrink: 0;
}
.ws-name { font-size: 19px; font-weight: 600; color: var(--text-1); }
.ws-last { font-size: 11.5px; color: var(--text-3); }
.ws-head-actions { display: flex; gap: 10px; flex-shrink: 0; }
.launch-btn { height: 38px; padding: 0 20px; font-size: 13.5px; }
.launch-btn:disabled { opacity: 0.6; cursor: wait; }

/* ---- 卡片通用 ---- */
.ws-card {
  background: var(--bg-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card), inset 0 0 0 1px var(--divider);
  padding: 16px 18px;
}
.ws-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ws-card-title { font-size: 13px; font-weight: 600; color: var(--text-2); }
.ws-card-meta { display: flex; align-items: center; gap: 10px; }
.meta-chip {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 2px 9px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}
.btn-sm { height: 26px; padding: 0 12px; font-size: 11.5px; }

/* ---- 准备面板 ---- */
.ws-tool-list { display: flex; flex-direction: column; }
.ws-tool-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-btn);
  cursor: grab;
  transition: background var(--dur-fast) var(--ease);
}
.ws-tool-row:hover { background: var(--bg-card-hover); }
.ws-tool-row:active { cursor: grabbing; }
.ws-check {
  width: 18px; height: 18px;
  border-radius: 6px;
  border: 1.5px solid var(--divider-strong);
  background: var(--bg-elevated);
  display: grid; place-items: center;
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.ws-check:hover { border-color: var(--accent); }
.ws-check.on { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.chk-mark { font-size: 11px; color: #fff; font-weight: 700; }
.ws-check.running { border-color: var(--success); }
.ws-tool-info { flex: 1; min-width: 0; }
.ws-tool-name {
  font-size: 13px; font-weight: 500; color: var(--text-1);
  display: flex; align-items: center; gap: 6px;
}
.run-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse-dot 1.8s infinite;
  flex-shrink: 0;
}
.ws-tool-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.ws-tool-type {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.5px;
  color: var(--text-3); background: var(--bg-input);
  padding: 2px 7px; border-radius: 20px; flex-shrink: 0;
}
.ws-empty {
  padding: 28px 0;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: var(--text-3); font-size: 13px;
}
.ws-hint { margin-top: 10px; font-size: 11.5px; color: var(--text-3); }
.ws-hint code {
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: Consolas, monospace;
  font-size: 11px;
}

/* ---- 项目目录 ---- */
.ws-path-list { display: flex; flex-direction: column; }
.ws-path-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--divider);
}
.ws-path-row:last-child { border-bottom: none; }
.path-name { font-size: 12.5px; color: var(--text-1); flex-shrink: 0; max-width: 140px; }
.path-val { font-size: 11px; color: var(--text-3); flex: 1; font-family: Consolas, monospace; }
.mono { font-family: Consolas, monospace; }
.kv-del {
  width: 24px; height: 24px;
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-3);
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.kv-del:hover { background: var(--danger-soft); color: var(--danger); }
.ws-mini-empty { font-size: 12px; color: var(--text-3); padding: 4px 0 10px; }
.ws-add-path { display: flex; gap: 8px; margin-top: 10px; }
.ws-add-path .input { height: 32px; font-size: 12px; }
.ws-add-path .input:first-child { width: 180px; flex-shrink: 0; }
.path-input { flex: 1; cursor: pointer; }

/* ---- 空间不存在 ---- */
.ws-gone {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 8px; text-align: center;
}
.ws-gone .empty-icon { font-size: 56px; }
.ws-gone h3 { font-size: 16px; }
.ws-gone p { font-size: 12.5px; color: var(--text-3); margin-bottom: 8px; }
</style>
