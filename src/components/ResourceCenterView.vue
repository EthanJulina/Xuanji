<script setup>
// ============================================================
// Payload / 资源中心(v2.1)—— 引用式文件管理
// 左列表(搜索/标签/收藏/状态过滤 + 列表/网格双视图)+ 右预览面板
// 预览:文本白名单扩展名,最多 200 行(主进程 resource:preview)
// 悬空引用标红;打开 = 系统默认程序;显示 = 资源管理器定位
// 数据:resources[](渲染层 CRUD,走 persist 全量保存)
// ============================================================
import { ref, computed, watch, onMounted } from 'vue'
import { s, toast, confirmBox, persist } from '../composables/store'

const qd = window.qd

const kw = ref('')
const tagFilter = ref('')
const favOnly = ref(false)
const viewMode = ref('list')            // list | grid
const selId = ref(null)
const existsMap = ref({})               // id → 存在性
const checking = ref(false)

/* ---- 列表 ---- */
const resources = computed(() => s.data.resources || [])

const allTags = computed(() => {
  const set = new Set()
  for (const r of resources.value) for (const t of r.tags || []) set.add(t)
  return [...set]
})

const danglingCount = computed(() => resources.value.filter(r => existsMap.value[r.id] === false).length)

const filtered = computed(() => {
  const k = kw.value.trim().toLowerCase()
  return resources.value.filter(r => {
    if (favOnly.value && !r.favorite) return false
    if (tagFilter.value && !(r.tags || []).includes(tagFilter.value)) return false
    if (k) {
      const hay = [r.name, r.path, r.desc || '', ...(r.tags || [])].join(' ').toLowerCase()
      if (!hay.includes(k)) return false
    }
    return true
  })
})

const sorted = computed(() => [...filtered.value].sort((a, b) => {
  if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1
  return String(a.name).localeCompare(String(b.name))
}))

const cur = computed(() => resources.value.find(r => r.id === selId.value) || null)
const curExists = computed(() => selId.value ? existsMap.value[selId.value] !== false : true)

/* ---- 存在性批量检查 ---- */
async function checkExists() {
  checking.value = true
  const map = {}
  for (const r of resources.value) {
    map[r.id] = await qd.fsExists(r.path)
  }
  existsMap.value = map
  checking.value = false
}
watch(resources, () => checkExists(), { deep: false })
onMounted(checkExists)

/* ---- 预览 ---- */
const preview = ref(null)               // resource:preview 返回值
const previewLoading = ref(false)

async function loadPreview() {
  preview.value = null
  if (!cur.value || !curExists.value) return
  previewLoading.value = true
  preview.value = await qd.resourcePreview(cur.value.path)
  previewLoading.value = false
}
watch([selId, () => existsMap.value[selId.value]], loadPreview)

/* ---- 编辑弹窗 ---- */
const modal = ref({ open: false, editId: null })
const form = ref({ name: '', path: '', tags: '', desc: '' })
const formTags = computed(() => form.value.tags.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean))

function openCreate() {
  form.value = { name: '', path: '', tags: '', desc: '' }
  modal.value = { open: true, editId: null }
}
function openEdit(r) {
  form.value = { name: r.name, path: r.path, tags: (r.tags || []).join(', '), desc: r.desc || '' }
  modal.value = { open: true, editId: r.id }
}
watch(() => modal.value.open, (open) => { if (open) checkExists() })

async function pickFile() {
  const p = await qd.pickTool()          // 复用工具选择器(任意文件)
  if (p) {
    form.value.path = p
    if (!form.value.name.trim()) {
      form.value.name = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
    }
  }
}

async function save() {
  if (!form.value.name.trim()) { toast('资源名称不能为空', 'error'); return }
  if (!form.value.path.trim()) { toast('请填写或选择文件路径', 'error'); return }
  if (modal.value.editId) {
    const r = resources.value.find(x => x.id === modal.value.editId)
    if (r) {
      Object.assign(r, {
        name: form.value.name.trim(),
        path: form.value.path.trim(),
        tags: formTags.value,
        desc: form.value.desc.trim()
      })
      persist(true)
      toast('资源已保存', 'success')
    }
  } else {
    s.data.resources.push({
      id: 'res-' + Math.random().toString(36).slice(2, 10),
      name: form.value.name.trim(),
      path: form.value.path.trim(),
      tags: formTags.value,
      desc: form.value.desc.trim(),
      favorite: false,
      createdAt: new Date().toISOString().slice(0, 19)
    })
    persist(true)
    toast('资源已添加', 'success')
  }
  modal.value.open = false
  await checkExists()
}

async function doRemove(r) {
  const yes = await confirmBox({
    title: '删除资源',
    message: `从资源中心移除「${r.name}」?`,
    detail: '仅移除引用记录,文件本身不会被删除。',
    confirmText: '移除'
  })
  if (!yes) return
  s.data.resources = s.data.resources.filter(x => x.id !== r.id)
  if (selId.value === r.id) selId.value = null
  persist(true)
  toast('资源已移除(文件未受影响)', 'success')
}

async function toggleFav(r) {
  r.favorite = !r.favorite
  persist(true)
}

/* ---- 动作 ---- */
async function openRes(r) {
  if (existsMap.value[r.id] === false) { toast('文件不存在(悬空引用),请先更新路径', 'error'); return }
  const res = await qd.resourceOpen(r.path)
  if (!res.ok) toast(res.message || '打开失败', 'error')
}
function showRes(r) { qd.showInFolder(r.path) }

/* ---- 展示辅助 ---- */
function extOf(p) { const m = String(p || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : '' }
function fileIcon(r) {
  const e = extOf(r.path)
  if (['exe', 'msi'].includes(e)) return '⚙️'
  if (['bat', 'cmd', 'ps1', 'sh'].includes(e)) return '📜'
  if (['json', 'yaml', 'yml', 'xml', 'ini', 'conf', 'cfg'].includes(e)) return '🧾'
  if (['txt', 'md', 'log'].includes(e)) return '📄'
  if (['zip', 'rar', '7z', 'gz'].includes(e)) return '🗜'
  if (['pcap', 'pcapng'].includes(e)) return '🕸'
  return '🗂'
}
</script>

<template>
  <div class="rc-view">
    <!-- 顶栏 -->
    <div class="rc-head">
      <div class="rc-title">
        <span class="rc-ico">🗂</span>
        <h2>Payload / 资源中心</h2>
        <span class="rc-sub">{{ resources.length }} 个资源 · 引用式管理,不复制文件
          <template v-if="danglingCount"> · <span class="dangling-tip">{{ danglingCount }} 个悬空引用</span></template>
        </span>
      </div>
      <div class="rc-actions">
        <div class="seg">
          <button class="seg-item" :class="{ on: viewMode === 'list' }" @click="viewMode = 'list'">☰ 列表</button>
          <button class="seg-item" :class="{ on: viewMode === 'grid' }" @click="viewMode = 'grid'">▦ 网格</button>
        </div>
        <button class="btn btn-ghost sm" :disabled="checking" @click="checkExists">{{ checking ? '检查中…' : '↻ 检查引用' }}</button>
        <button class="btn btn-primary" @click="openCreate">＋ 添加资源</button>
      </div>
    </div>

    <!-- 过滤条 -->
    <div class="rc-filter">
      <div class="rc-search">
        <span class="s-ico">🔍</span>
        <input v-model="kw" placeholder="搜索名称 / 路径 / 标签" spellcheck="false" />
      </div>
      <button class="rc-chip" :class="{ on: favOnly }" @click="favOnly = !favOnly">★ 仅收藏</button>
      <button v-if="allTags.length" class="rc-chip" :class="{ on: !tagFilter }" @click="tagFilter = ''">全部标签</button>
      <button v-for="t in allTags" :key="t" class="rc-chip" :class="{ on: tagFilter === t }"
              @click="tagFilter = tagFilter === t ? '' : t">#{{ t }}</button>
    </div>

    <div class="rc-body">
      <!-- 资源区 -->
      <div class="rc-list-wrap">
        <!-- 列表视图 -->
        <div v-if="viewMode === 'list'" class="rc-list scroll-area">
          <div v-for="r in sorted" :key="r.id"
               class="rc-row" :class="{ on: selId === r.id, dangling: existsMap[r.id] === false }"
               @click="selId = r.id">
            <span class="rr-ico">{{ fileIcon(r) }}</span>
            <span class="rr-main">
              <span class="rr-name">
                {{ r.name }}
                <span v-if="r.favorite" class="rr-fav">★</span>
                <span v-if="existsMap[r.id] === false" class="rr-missing">悬空</span>
              </span>
              <span class="rr-path mono">{{ r.path }}</span>
            </span>
            <span class="rr-tags">
              <span v-for="t in (r.tags || []).slice(0, 3)" :key="t" class="rr-tag">#{{ t }}</span>
            </span>
            <span class="rr-acts" @click.stop>
              <button class="rr-btn" :title="r.favorite ? '取消收藏' : '收藏'" @click="toggleFav(r)">{{ r.favorite ? '★' : '☆' }}</button>
              <button class="rr-btn" title="用系统默认程序打开" @click="openRes(r)">▶</button>
              <button class="rr-btn" title="在资源管理器中显示" @click="showRes(r)">📁</button>
              <button class="rr-btn" title="编辑" @click="openEdit(r)">✏️</button>
              <button class="rr-btn danger" title="移除" @click="doRemove(r)">🗑</button>
            </span>
          </div>
          <div v-if="!sorted.length" class="rc-empty">
            {{ resources.length ? '没有匹配的资源' : '还没有资源。添加 wordlist、字典、配置文件等常用 Payload,一处引用随处打开。' }}
          </div>
        </div>

        <!-- 网格视图 -->
        <div v-else class="rc-grid scroll-area">
          <button v-for="r in sorted" :key="r.id"
                  class="rc-card" :class="{ on: selId === r.id, dangling: existsMap[r.id] === false }"
                  @click="selId = r.id" @dblclick="openRes(r)">
            <span class="rc-card-ico">{{ fileIcon(r) }}</span>
            <span class="rc-card-name">{{ r.name }} <span v-if="r.favorite">★</span></span>
            <span class="rc-card-path mono">{{ r.path }}</span>
            <span v-if="existsMap[r.id] === false" class="rc-card-missing">⚠ 悬空引用</span>
            <span v-if="(r.tags || []).length" class="rc-card-tags">
              <span v-for="t in r.tags.slice(0, 3)" :key="t" class="rr-tag">#{{ t }}</span>
            </span>
          </button>
          <div v-if="!sorted.length" class="rc-empty">没有匹配的资源</div>
        </div>
      </div>

      <!-- 预览面板 -->
      <div class="rc-preview">
        <template v-if="cur">
          <div class="pv-head">
            <span class="pv-name">{{ cur.name }}</span>
            <span class="pv-ext" v-if="extOf(cur.path)">.{{ extOf(cur.path) }}</span>
          </div>
          <div class="pv-path mono">{{ cur.path }}</div>
          <p v-if="cur.desc" class="pv-desc">{{ cur.desc }}</p>

          <div v-if="!curExists" class="pv-state danger">
            ⚠ 悬空引用:文件不存在,可能已被移动或删除。请编辑更新路径。
          </div>
          <div v-else-if="previewLoading" class="pv-state">加载预览…</div>
          <template v-else-if="preview">
            <div v-if="!preview.ok" class="pv-state warn">{{ preview.message }}</div>
            <template v-else>
              <div class="pv-meta">{{ preview.lines.length }} 行{{ preview.truncated ? `(共 ${preview.totalLines} 行,已截断)` : '' }} · {{ (preview.size / 1024).toFixed(1) }} KB</div>
              <pre class="pv-content mono scroll-area"><code>{{ preview.lines.join('\n') }}</code></pre>
            </template>
          </template>

          <div class="pv-btns">
            <button class="btn btn-primary" @click="openRes(cur)">▶ 打开</button>
            <button class="btn" @click="showRes(cur)">📁 显示</button>
            <button class="btn" @click="openEdit(cur)">✏️ 编辑</button>
          </div>
        </template>
        <div v-else class="pv-none">
          <div class="pv-none-ico">🗂</div>
          <p>从左侧选择资源查看预览</p>
          <p class="pv-none-sub">文本文件(白名单类型)最多预览 200 行</p>
        </div>
      </div>
    </div>

    <!-- 新建/编辑弹窗 -->
    <Transition name="modal-mask">
      <div v-if="modal.open" class="rc-mask" @mousedown.self="modal.open = false">
        <Transition name="modal-box" appear>
          <div class="rc-box">
            <h3>{{ modal.editId ? '编辑资源' : '添加资源' }}</h3>
            <div class="f-row">
              <input v-model="form.name" class="f-input" placeholder="资源名称 *" spellcheck="false" />
              <button class="btn" @click="pickFile">📂 浏览…</button>
            </div>
            <input v-model="form.path" class="f-input mono" placeholder="文件完整路径 *" spellcheck="false" />
            <input v-model="form.tags" class="f-input" placeholder="标签(逗号分隔,如:wordlist, 内网)" spellcheck="false" />
            <input v-model="form.desc" class="f-input" placeholder="备注(可选)" spellcheck="false" />
            <div class="rc-box-foot">
              <button class="btn" @click="modal.open = false">取消</button>
              <button class="btn btn-primary" @click="save">保存</button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.rc-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ---- 顶栏 ---- */
.rc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 10px;
  flex-shrink: 0;
  gap: 12px;
}
.rc-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.rc-ico { font-size: 18px; }
.rc-title h2 { font-size: 17px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
.rc-sub { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dangling-tip { color: var(--danger); }
.rc-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.sm { height: 26px; padding: 0 10px; font-size: 12px; }
.seg { display: flex; padding: 2px; border-radius: var(--radius-btn); background: var(--bg-input); }
.seg-item {
  height: 26px; padding: 0 10px;
  border-radius: 6px; font-size: 11.5px; color: var(--text-3);
}
.seg-item.on { background: var(--bg-elevated); color: var(--text-1); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); }

/* ---- 过滤条 ---- */
.rc-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.rc-search { position: relative; width: 220px; }
.s-ico { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.6; pointer-events: none; }
.rc-search input {
  width: 100%;
  height: 28px;
  padding: 0 10px 0 25px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  color: var(--text-1);
  font-size: 12px;
}
.rc-search input:focus { border-color: var(--accent); outline: none; }
.rc-chip {
  height: 26px;
  padding: 0 11px;
  border-radius: 13px;
  font-size: 11.5px;
  color: var(--text-3);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  transition: all var(--dur-fast) var(--ease);
}
.rc-chip:hover { color: var(--text-2); }
.rc-chip.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

/* ---- 主体 ---- */
.rc-body { flex: 1; display: flex; min-height: 0; padding: 0 20px 16px; gap: 12px; }
.rc-list-wrap { flex: 1; min-width: 0; display: flex; }

/* 列表视图 */
.rc-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
.rc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.rc-row:hover { background: var(--bg-card-hover); }
.rc-row.on { border-color: var(--accent); background: var(--accent-soft); }
.rc-row.dangling { border-color: rgba(255, 93, 93, 0.5); }
.rr-ico { font-size: 16px; flex-shrink: 0; }
.rr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rr-name { font-size: 12.5px; font-weight: 500; color: var(--text-1); }
.rr-fav { color: var(--warning); }
.rr-missing {
  font-size: 9.5px;
  color: var(--danger);
  background: rgba(255, 93, 93, 0.14);
  padding: 1px 6px;
  border-radius: 7px;
  margin-left: 4px;
}
.rr-path {
  font-size: 10.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono { font-family: Consolas, "Courier New", monospace; }
.rr-tags { display: flex; gap: 4px; flex-shrink: 0; }
.rr-tag {
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 7px;
  border-radius: 8px;
}
.rr-acts { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity var(--dur-fast) var(--ease); }
.rc-row:hover .rr-acts { opacity: 1; }
.rr-btn {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  font-size: 11px;
  border-radius: 6px;
  color: var(--text-3);
}
.rr-btn:hover { background: var(--bg-input); color: var(--text-1); }
.rr-btn.danger:hover { background: rgba(255, 93, 93, 0.12); color: var(--danger); }

/* 网格视图 */
.rc-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
  align-content: start;
}
.rc-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 13px;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  text-align: left;
  transition: all var(--dur-fast) var(--ease);
}
.rc-card:hover { background: var(--bg-card-hover); transform: translateY(-1px); }
.rc-card.on { border-color: var(--accent); background: var(--accent-soft); }
.rc-card.dangling { border-color: rgba(255, 93, 93, 0.5); }
.rc-card-ico { font-size: 22px; }
.rc-card-name { font-size: 12.5px; font-weight: 500; color: var(--text-1); width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-card-path { font-size: 10px; color: var(--text-3); width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-card-missing { font-size: 10px; color: var(--danger); }
.rc-card-tags { display: flex; gap: 4px; }

.rc-empty {
  padding: 30px 14px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  line-height: 2;
  border: 1px dashed var(--divider-strong);
  border-radius: var(--radius-card);
  grid-column: 1 / -1;
}

/* ---- 预览面板 ---- */
.rc-preview {
  width: 320px;
  flex-shrink: 0;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.pv-head { display: flex; align-items: center; gap: 8px; }
.pv-name { font-size: 13.5px; font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-ext {
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 7px;
  border-radius: 8px;
  flex-shrink: 0;
}
.pv-path { font-size: 10.5px; color: var(--text-3); word-break: break-all; }
.pv-desc { font-size: 11.5px; color: var(--text-2); }
.pv-state { font-size: 12px; padding: 14px 12px; border-radius: var(--radius-btn); text-align: center; }
.pv-state.danger {
  color: var(--danger);
  background: rgba(255, 93, 93, 0.08);
  border: 1px dashed rgba(255, 93, 93, 0.4);
}
.pv-state.warn { color: var(--warning); background: rgba(254, 188, 46, 0.08); }
.pv-meta { font-size: 10.5px; color: var(--text-3); }
.pv-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-2);
  background: var(--bg-input);
  border-radius: var(--radius-btn);
  padding: 10px 12px;
  margin: 0;
  white-space: pre;
  user-select: text;
}
.pv-btns { display: flex; gap: 6px; }

.pv-none {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-3);
  font-size: 13px;
}
.pv-none-ico { font-size: 40px; opacity: 0.5; }
.pv-none-sub { font-size: 11px; opacity: 0.7; }

/* ---- 弹窗 ---- */
.rc-mask {
  position: fixed; inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px) saturate(1.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rc-box {
  width: 480px;
  max-width: calc(100vw - 48px);
  border-radius: 16px;
  background: var(--bg-elevated);
  backdrop-filter: blur(36px) saturate(1.7);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rc-box h3 { font-size: 15px; font-weight: 600; }
.f-row { display: flex; gap: 8px; }
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
.rc-box-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }

/* 过渡 */
.modal-mask-enter-active, .modal-mask-leave-active { transition: opacity 0.18s ease; }
.modal-mask-enter-from, .modal-mask-leave-to { opacity: 0; }
.modal-box-enter-active { transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
.modal-box-leave-active { transition: all 0.15s ease; }
.modal-box-enter-from { transform: scale(0.95) translateY(10px); opacity: 0; }
.modal-box-leave-to { transform: scale(0.97); opacity: 0; }
</style>
