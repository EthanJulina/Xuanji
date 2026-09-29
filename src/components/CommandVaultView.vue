<script setup>
// ============================================================
// 命令库 Command Vault(v2.1)
// 左列表(搜索/收藏/标签过滤)+ 右编辑器(模板/变量/标签)
// 变量语法 {{key}}:渲染优先级 workspace > globalVars > ask
// 运行 = 隐藏 cmd /c(弹窗表单 + 预览 + 危险确认),输出进日志中心
// ============================================================
import { ref, computed, watch } from 'vue'
import { s, toast, confirmBox, setView } from '../composables/store'
import {
  sortedCommands, commandById, createCommand, updateCommand, removeCommand,
  extractVars, resolveSources, openCommandRun, copyCommand
} from '../stores/commandStore'

const qd = window.qd
const kw = ref('')
const selId = ref(null)
const tagFilter = ref('')

/* ---- 列表 ---- */
const filteredCommands = computed(() => {
  let list = sortedCommands.value
  const k = kw.value.trim().toLowerCase()
  if (k) {
    list = list.filter(c =>
      c.name.toLowerCase().includes(k) ||
      (c.desc || '').toLowerCase().includes(k) ||
      (c.tags || []).some(t => String(t).toLowerCase().includes(k)) ||
      (c.template || '').toLowerCase().includes(k))
  }
  if (tagFilter.value) list = list.filter(c => (c.tags || []).includes(tagFilter.value))
  return list
})

// 全部标签(汇总)
const allTags = computed(() => {
  const set = new Set()
  for (const c of s.data.commands || []) for (const t of c.tags || []) set.add(t)
  return [...set]
})

const cur = computed(() => commandById(selId.value))

watch(filteredCommands, (list) => {
  if (selId.value && !list.some(c => c.id === selId.value)) selId.value = null
  if (!selId.value && list.length) selId.value = list[0].id
}, { immediate: true })

/* ---- 编辑表单(选中即载入;显式保存) ---- */
const form = ref({ name: '', emoji: '⌨️', desc: '', template: '', tags: '' })
const formTags = computed(() => form.value.tags.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean))

watch(cur, (c) => {
  if (!c) return
  form.value = {
    name: c.name || '',
    emoji: c.emoji || '⌨️',
    desc: c.desc || '',
    template: c.template || '',
    tags: (c.tags || []).join(', ')
  }
}, { immediate: true })

const dirty = ref(false)
watch(form, () => { dirty.value = true }, { deep: true })
watch(selId, () => { dirty.value = false })

const EMOJIS = ['⌨️', '🌐', '🔍', '💣', '🛡', '📦', '🚀', '🧹', '📊', '🧪', '⚙️', '🔗']

async function save() {
  if (!cur.value) return
  if (!form.value.name.trim()) { toast('命令名称不能为空', 'error'); return }
  await updateCommand(cur.value.id, {
    name: form.value.name.trim().slice(0, 60),
    emoji: form.value.emoji || '⌨️',
    desc: form.value.desc.trim(),
    template: form.value.template,
    tags: formTags.value
  })
  dirty.value = false
  toast('命令已保存', 'success')
}

async function create() {
  const cmd = await createCommand({ name: '新命令', template: '' })
  selId.value = cmd.id
  dirty.value = true
}

async function doRemove() {
  if (!cur.value) return
  const yes = await confirmBox({
    title: '删除命令',
    message: `删除命令「${cur.value.emoji} ${cur.value.name}」?`,
    detail: '仅删除命令模板本身;varMemory 记忆随条目一并删除,已落盘的运行日志保留。',
    confirmText: '删除'
  })
  if (!yes) return
  await removeCommand(cur.value.id)
  selId.value = null
  toast('命令已删除', 'success')
}

/* ---- 变量分析(模板 → 变量列表含来源) ---- */
const varInfos = computed(() => {
  if (!cur.value) return []
  const src = resolveSources(form.value.template)
  return Object.entries(src).map(([key, info]) => ({ key, ...info }))
})

function sourceClass(source) {
  return { workspace: 'src-ws', global: 'src-global', ask: 'src-ask' }[source] || ''
}
function sourceText(source) {
  return { workspace: '空间变量', global: '全局变量', ask: '运行时填写' }[source] || ''
}

/* ---- 全局变量快捷维护:globalVars key-value ---- */
// 模板占位提示(花括号字面量不能直接写进模板属性,统一走 JS 常量)
const TPL_HINT = '命令模板,变量用 {{key}} 占位。\n例:nmap -sV -p {{ports}} {{target}}\ncurl -H "Authorization: Bearer {{token}}" {{url}}'
const globalVarRows = computed(() => Object.entries(s.data.globalVars || {}))
const newGlobal = ref({ key: '', value: '' })
function addGlobalVar() {
  const k = newGlobal.value.key.trim()
  if (!k) { toast('变量名不能为空', 'error'); return }
  s.data.globalVars[k] = newGlobal.value.value
  newGlobal.value = { key: '', value: '' }
  persist()
  toast('全局变量已保存', 'success')
}
async function delGlobalVar(key) {
  delete s.data.globalVars[key]
  await persist()
}

/* ---- 动作 ---- */
function run() { if (cur.value) openCommandRun(cur.value) }
async function copy() { if (cur.value) await copyCommand(cur.value) }
async function toggleFav() {
  if (!cur.value) return
  await updateCommand(cur.value.id, { favorite: !cur.value.favorite })
}

/* ---- 日志中心跳转:查看该命令的运行输出 ---- */
function openLogs() {
  if (!cur.value) return
  setView({ type: 'logcenter', id: cur.value.id })
}
</script>

<template>
  <div class="cv-view">
    <!-- 顶栏 -->
    <div class="cv-head">
      <div class="cv-title">
        <span class="cv-ico">⌨️</span>
        <h2>命令库 <span class="en">Command Vault</span></h2>
        <span class="cv-sub">{{ s.data.commands.length }} 条命令 · 变量优先级 空间 &gt; 全局 &gt; 运行时填写</span>
      </div>
      <button class="btn btn-primary" @click="create">＋ 新建命令</button>
    </div>

    <div class="cv-body">
      <!-- 左列表 -->
      <div class="cv-side">
        <div class="cv-side-search">
          <span class="ss-ico">🔍</span>
          <input v-model="kw" placeholder="搜索命令 / 模板 / 标签" spellcheck="false" />
        </div>
        <div v-if="allTags.length" class="cv-tags">
          <button class="cv-tag" :class="{ on: !tagFilter }" @click="tagFilter = ''">全部</button>
          <button v-for="t in allTags" :key="t" class="cv-tag" :class="{ on: tagFilter === t }"
                  @click="tagFilter = tagFilter === t ? '' : t">#{{ t }}</button>
        </div>
        <div class="cv-list scroll-area">
          <button v-for="c in filteredCommands" :key="c.id"
                  class="cv-item" :class="{ on: selId === c.id }"
                  @click="selId = c.id">
            <span class="ci-emoji">{{ c.emoji || '⌨️' }}</span>
            <span class="ci-main">
              <span class="ci-name">{{ c.name }} <span v-if="c.favorite" class="ci-fav">★</span></span>
              <span class="ci-tpl">{{ c.template || '(空模板)' }}</span>
            </span>
            <span class="ci-runs">{{ c.runCount || 0 }}</span>
          </button>
          <div v-if="!filteredCommands.length" class="cv-empty">
            {{ s.data.commands.length ? '没有匹配的命令' : '还没有命令。点右上角「新建命令」,模板里用双花括号写变量占位符。' }}
          </div>
        </div>
      </div>

      <!-- 右编辑区 -->
      <div v-if="cur" class="cv-main scroll-area">
        <!-- 编辑表单 -->
        <div class="cv-card">
          <div class="cv-card-head">
            <h4>命令信息</h4>
            <div class="cv-card-actions">
              <button class="btn btn-ghost sm" @click="toggleFav">{{ cur.favorite ? '★ 取消收藏' : '☆ 收藏' }}</button>
              <button class="btn btn-ghost sm" @click="copy">📋 复制</button>
              <button class="btn btn-ghost sm" @click="openLogs">📄 运行日志</button>
              <button class="btn btn-danger sm" @click="doRemove">删除</button>
            </div>
          </div>
          <div class="f-row">
            <div class="f-emoji-pick">
              <!-- 点选仅改表单(点亮 dirty 提示),统一由「保存修改」提交 —— 之前点一下立即保存并弹 toast,与其他字段行为不一致 -->
              <button v-for="e in EMOJIS" :key="e" class="f-emoji" :class="{ on: form.emoji === e }"
                      @click="form.emoji = e">{{ e }}</button>
            </div>
          </div>
          <div class="f-row">
            <input v-model="form.name" class="f-input" placeholder="命令名称" spellcheck="false" />
            <input v-model="form.tags" class="f-input f-tags" placeholder="标签(逗号分隔,如:内网, recon)" spellcheck="false" />
          </div>
          <input v-model="form.desc" class="f-input" placeholder="备注说明(可选)" spellcheck="false" />
          <textarea v-model="form.template" class="f-template mono" rows="5" spellcheck="false"
                    :placeholder="TPL_HINT"></textarea>
          <div class="f-save-row">
            <span v-if="dirty" class="f-dirty">● 有未保存的修改</span>
            <span v-else class="f-clean">已保存</span>
            <button class="btn btn-primary" :disabled="!dirty" @click="save">保存修改</button>
          </div>
        </div>

        <!-- 变量分析 -->
        <div class="cv-card">
          <div class="cv-card-head">
            <h4>变量解析 <span class="h-sub">{{ varInfos.length }} 个 · 优先级 空间 &gt; 全局 &gt; 运行时填写</span></h4>
          </div>
          <div v-if="varInfos.length" class="var-list">
            <div v-for="v in varInfos" :key="v.key" class="var-row">
              <code class="var-key" v-text="'{{' + v.key + '}}'"></code>
              <span class="var-src" :class="sourceClass(v.source)">{{ sourceText(v.source) }}</span>
              <span class="var-val mono">{{ v.source === 'ask' ? (cur.varMemory?.[v.key] ? `记忆:${cur.varMemory[v.key]}` : '(待填写)') : v.value }}</span>
            </div>
          </div>
          <p v-else class="cv-note">模板中没有双花括号变量 — 纯静态命令,运行弹窗会直接预览执行</p>
        </div>

        <!-- 全局变量 -->
        <div class="cv-card">
          <div class="cv-card-head">
            <h4>全局变量 <span class="h-sub">所有命令共用;工作空间变量在工作空间内维护</span></h4>
          </div>
          <div v-if="globalVarRows.length" class="gv-list">
            <div v-for="[k, v] in globalVarRows" :key="k" class="gv-row">
              <code class="var-key">{{ k }}</code>
              <span class="gv-val mono">{{ v }}</span>
              <button class="gv-del" title="删除变量" @click="delGlobalVar(k)">✕</button>
            </div>
          </div>
          <p v-else class="cv-note">还没有全局变量。适合放 token、目标域名、常用路径等。</p>
          <div class="gv-add">
            <input v-model="newGlobal.key" class="f-input gv-k mono" placeholder="变量名" spellcheck="false" @keydown.enter="addGlobalVar" />
            <input v-model="newGlobal.value" class="f-input gv-v mono" placeholder="值" spellcheck="false" @keydown.enter="addGlobalVar" />
            <button class="btn" @click="addGlobalVar">添加</button>
          </div>
        </div>
      </div>

      <!-- 未选中 -->
      <div v-else class="cv-main cv-none">
        <div class="none-ico">⌨️</div>
        <p>{{ s.data.commands.length ? '从左侧选择一条命令' : '还没有命令,点右上角「新建命令」开始' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cv-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ---- 顶栏 ---- */
.cv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}
.cv-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.cv-ico { font-size: 18px; }
.cv-title h2 { font-size: 17px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
.cv-title .en { font-size: 12px; color: var(--text-3); font-weight: 400; }
.cv-sub { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- 主体 ---- */
.cv-body { flex: 1; display: flex; min-height: 0; padding: 0 20px 16px; gap: 12px; }

/* 左列表 */
.cv-side {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.cv-side-search { position: relative; flex-shrink: 0; }
.ss-ico { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.6; pointer-events: none; }
.cv-side-search input {
  width: 100%;
  height: 30px;
  padding: 0 10px 0 26px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  color: var(--text-1);
  font-size: 12px;
}
.cv-side-search input:focus { border-color: var(--accent); outline: none; }
.cv-tags { display: flex; flex-wrap: wrap; gap: 4px; flex-shrink: 0; }
.cv-tag {
  font-size: 10.5px;
  color: var(--text-3);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  padding: 2px 9px;
  border-radius: 10px;
  transition: all var(--dur-fast) var(--ease);
}
.cv-tag:hover { color: var(--text-2); }
.cv-tag.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.cv-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
.cv-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  text-align: left;
  transition: all var(--dur-fast) var(--ease);
}
.cv-item:hover { background: var(--bg-card-hover); }
.cv-item.on { border-color: var(--accent); background: var(--accent-soft); }
.ci-emoji { font-size: 15px; flex-shrink: 0; }
.ci-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ci-name { font-size: 12.5px; font-weight: 500; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ci-fav { color: var(--warning); }
.ci-tpl {
  font-family: Consolas, monospace;
  font-size: 10.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ci-runs {
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 7px;
  border-radius: 9px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.cv-empty {
  padding: 30px 14px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  line-height: 2;
  border: 1px dashed var(--divider-strong);
  border-radius: var(--radius-card);
}

/* 右编辑区 */
.cv-main { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.cv-none {
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 13px;
  gap: 10px;
}
.none-ico { font-size: 44px; opacity: 0.5; }

.cv-card {
  background: var(--bg-card);
  border: 1px solid var(--divider);
  border-radius: var(--radius-card);
  padding: 14px;
  flex-shrink: 0;
}
.cv-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.cv-card-head h4 { font-size: 13.5px; font-weight: 600; color: var(--text-1); }
.h-sub { font-size: 11px; color: var(--text-3); font-weight: 400; margin-left: 6px; }
.cv-card-actions { display: flex; gap: 6px; }
.sm { height: 26px; padding: 0 10px; font-size: 12px; }

/* 表单 */
.f-row { display: flex; gap: 8px; margin-bottom: 8px; }
.f-emoji-pick { display: flex; flex-wrap: wrap; gap: 4px; }
.f-emoji {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  font-size: 15px;
  border-radius: 7px;
  border: 1px solid transparent;
  transition: all var(--dur-fast) var(--ease);
}
.f-emoji:hover { background: var(--bg-input); }
.f-emoji.on { background: var(--accent-soft); border-color: var(--accent); }
.f-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 12.5px;
  min-width: 0;
}
.f-input:focus { border-color: var(--accent); outline: none; }
.f-tags { flex: 1; }
.f-row + .f-input { margin-bottom: 8px; }
.f-input { margin-bottom: 8px; }
.f-template {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 12.5px;
  line-height: 1.7;
  resize: vertical;
  margin-bottom: 8px;
}
.f-template:focus { border-color: var(--accent); outline: none; }
.mono { font-family: Consolas, "Courier New", monospace; }
.f-save-row { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.f-dirty { font-size: 11.5px; color: var(--warning); }
.f-clean { font-size: 11.5px; color: var(--text-3); }

/* 变量分析 */
.var-list { display: flex; flex-direction: column; gap: 6px; }
.var-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.var-key {
  font-family: Consolas, monospace;
  font-size: 11.5px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}
.var-src {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 9px;
  flex-shrink: 0;
  font-weight: 600;
}
.src-ws { color: #7BC96F; background: rgba(123, 201, 111, 0.14); }
.src-global { color: #4F8CFF; background: rgba(79, 140, 255, 0.14); }
.src-ask { color: #E8A33D; background: rgba(232, 163, 61, 0.14); }
.var-val {
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.cv-note { font-size: 12px; color: var(--text-3); line-height: 1.8; }

/* 全局变量 */
.gv-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.gv-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--divider);
}
.gv-row:last-child { border-bottom: none; }
.gv-val { flex: 1; font-size: 11.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gv-del {
  width: 20px; height: 20px;
  border-radius: 5px;
  font-size: 9px;
  color: var(--text-3);
  flex-shrink: 0;
}
.gv-del:hover { background: rgba(255, 93, 93, 0.12); color: var(--danger); }
.gv-add { display: flex; gap: 8px; }
.gv-k { flex: 0 0 160px; margin-bottom: 0; }
.gv-v { flex: 1; margin-bottom: 0; }
</style>
