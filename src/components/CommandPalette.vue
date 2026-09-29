<script setup>
// 命令面板 Ctrl+K(v2.0 统一搜索入口)
// 索引:工具 / 工作空间 / 命令(P1 数据)/ 资源(P1 数据)
// 分组展示 + ↑↓ 跨组移动 + Enter 执行默认动作:
//   工具 = 以 active 配置运行;工作空间 = 进入;命令 = 复制模板;资源 = 资源管理器显示
// 防抖 ≤100ms;无输入保留「最近运行 5 项 + 置顶工具」原行为
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  s, askRun, categoryById, toast
} from '../composables/store'
import { si, searchGroups, flatResults } from '../stores/searchIndexStore'
import { openWorkspace } from '../stores/workspaceStore'
import { openCommandRun, resolveSources, renderTemplate } from '../stores/commandStore'
import { isDockPinned, toggleDockPin } from '../stores/dockStore'
import { highlight } from '../utils/highlight'
import ToolIcon from './ToolIcon.vue'

const qd = window.qd
const input = ref(null)
const activeIdx = ref(0)
const listEl = ref(null)

/* ---- 输入防抖(≤100ms,需求硬性指标) ---- */
let debounceTimer = null
function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { si.debounced = si.query }, 90)
}

const kw = computed(() => si.debounced.trim())

/* ---- 打开 / 关闭 ---- */
function open() {
  s.palette.open = true
  si.query = ''
  si.debounced = ''
  activeIdx.value = 0
  nextTick(() => input.value?.focus())
}
function close() { s.palette.open = false }

function onGlobalKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    s.palette.open ? close() : open()
  }
}
window.addEventListener('keydown', onGlobalKey)

// 全局快捷键 Ctrl+Space(主进程 globalShortcut,窗口隐藏/最小化时也能呼出)
qd.onPaletteToggle?.(() => {
  s.palette.open ? close() : open()
})

watch(kw, () => { activeIdx.value = 0 })
watch(flatResults, () => { if (activeIdx.value >= flatResults.value.length) activeIdx.value = 0 })

/* ---- 默认动作(Enter / 单击) ---- */
function execute(entry) {
  const { kind, item } = entry
  close()
  if (kind === 'tool') {
    askRun(item)                       // 以 active 配置运行(原路径,无新增步骤)
  } else if (kind === 'workspace') {
    openWorkspace(item.id)             // 进入工作空间
  } else if (kind === 'command') {
    // v2.1:打开命令运行弹窗(变量表单 + 预览 + 危险确认;Shift+Enter 才是复制模板)
    openCommandRun(item)
  } else if (kind === 'resource') {
    // v2.1:资源 = 用系统默认程序打开(悬空时主进程返回错误提示)
    openResource(item)
  }
}

async function openResource(res) {
  const r = await qd.resourceOpen(res.path)
  if (!r.ok) toast(r.message || '打开失败(文件可能不存在)', 'error')
}

// v2.1:Shift+Enter = 复制命令模板(渲染优先;变量不齐时复制原文)
async function copyCommandEntry(cmd) {
  close()
  const src = resolveSources(cmd.template)
  const askLeft = Object.values(src).filter(i => i.source === 'ask')
  if (!askLeft.length) {
    const { text } = renderTemplate(cmd.template, Object.fromEntries(Object.entries(src).map(([k, i]) => [k, i.value])))
    await qd.copyText(text)
    toast('已复制渲染后的命令', 'success')
  } else {
    await qd.copyText(cmd.template || '')
    toast(`已复制模板原文(${askLeft.length} 个变量需运行时填写)`, 'info')
  }
}

/* ---- 键盘导航(跨组移动) ---- */
function onKey(e) {
  if (!s.palette.open) return
  const n = flatResults.value.length
  if (e.key === 'Escape') { close(); e.preventDefault() }
  if (e.key === 'ArrowDown') { activeIdx.value = (activeIdx.value + 1) % Math.max(n, 1); scrollToActive(); e.preventDefault() }
  if (e.key === 'ArrowUp') { activeIdx.value = (activeIdx.value - 1 + Math.max(n, 1)) % Math.max(n, 1); scrollToActive(); e.preventDefault() }
  if (e.key === 'Enter') {
    const entry = flatResults.value[activeIdx.value]
    if (!entry) return
    if (e.shiftKey && entry.kind === 'command') {
      // v2.1:Shift+Enter = 复制命令(渲染优先)
      copyCommandEntry(entry.item)
    } else if (e.ctrlKey && entry.kind === 'tool') {
      // Ctrl+Enter 打开编辑(保留原有行为)
      close()
      s.toolModal.open = true
      s.toolModal.editId = entry.item.id
      s.toolModal.tab = 'basic'
    } else {
      execute(entry)
    }
    e.preventDefault()
  }
}

function scrollToActive() {
  nextTick(() => {
    listEl.value?.querySelector('.p-item.active')?.scrollIntoView({ block: 'nearest' })
  })
}

/* ---- 空态快捷动作 ---- */
function goAdd() { close(); s.toolModal.open = true; s.toolModal.editId = null }
function goNewWs() {
  close()
  s.wsModal.open = true
  s.wsModal.editId = null
}

/* ---- 各类型条目的副标题 ---- */
function subOf(entry) {
  const { kind, item } = entry
  if (kind === 'tool') {
    const cat = item.categoryId ? categoryById(item.categoryId) : null
    return cat ? `${cat.emoji} ${cat.name}` : '未分类'
  }
  if (kind === 'workspace') return `${(item.toolIds || []).length} 个工具 · ${item.paths?.length || 0} 个目录`
  if (kind === 'command') return (item.tags || []).join(' · ') || '命令模板'
  if (kind === 'resource') return (item.tags || []).join(' · ') || item.path || ''
  return ''
}

const KIND_ICON = { tool: '🧰', workspace: '🎯', command: '⌨️', resource: '🗂' }

function timeAgo(t) {
  if (!t.lastRunAt) return ''
  const diff = (Date.now() - new Date(t.lastRunAt).getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  return Math.floor(diff / 86400) + ' 天前'
}

// 高亮包装(工具名 / 工作空间名 / 命令名 / 资源名)
function nameParts(entry) {
  const name = entry.kind === 'tool' ? entry.item.name
    : entry.kind === 'workspace' ? entry.item.name
    : entry.kind === 'command' ? entry.item.name
    : entry.item.name
  return kw.value ? highlight(name, kw.value) : [{ text: name, hit: false }]
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  clearTimeout(debounceTimer)
})
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.palette.open" class="palette-mask" @mousedown.self="close">
      <Transition name="modal-box" appear>
        <div class="palette" @keydown="onKey">
          <!-- 输入框 -->
          <div class="p-input-row">
            <span class="p-search-ico">🔍</span>
            <input ref="input" v-model="si.query" class="p-input"
                   placeholder="搜索工具、工作空间、命令、资源…(↑↓ 选择,Enter 执行)"
                   @input="onInput" @keydown="onKey" />
            <span class="p-esc">Esc</span>
          </div>

          <!-- 结果列表:分组展示 -->
          <div ref="listEl" class="p-list scroll-area">
            <template v-if="flatResults.length">
              <div v-for="group in searchGroups" :key="group.key" class="p-group">
                <div class="p-group-label">{{ group.label }}</div>
                <button v-for="entry in group.items.map(item => ({ kind: group.kind, item }))"
                        :key="group.kind + ':' + entry.item.id"
                        class="p-item"
                        :class="{ active: flatResults[activeIdx]?.kind === entry.kind && flatResults[activeIdx]?.item?.id === entry.item.id }"
                        @click="execute(entry)"
                        @mouseenter="activeIdx = flatResults.findIndex(f => f.kind === entry.kind && f.item?.id === entry.item.id)">
                  <!-- 图标:工具用系统图标,其余用类型 emoji -->
                  <ToolIcon v-if="entry.kind === 'tool'" :tool="entry.item" :size="30" />
                  <span v-else class="p-kind-icon">{{ KIND_ICON[entry.kind] }}</span>

                  <div class="p-item-main">
                    <div class="p-item-name">
                      <template v-for="(part, i) in nameParts(entry)" :key="i">
                        <mark v-if="part.hit" class="hl">{{ part.text }}</mark>
                        <template v-else>{{ part.text }}</template>
                      </template>
                      <span v-if="entry.kind === 'tool' && timeAgo(entry.item)" class="p-time">{{ timeAgo(entry.item) }}</span>
                    </div>
                    <div class="p-item-sub">
                      <span class="p-cat">{{ subOf(entry) }}</span>
                    </div>
                  </div>
                  <span v-if="entry.kind === 'tool' && entry.item.pinned" class="p-pin">📌</span>
                  <!-- v2.1:Dock 固定快捷动作(hover 显示;span 避免 button 嵌套) -->
                  <span v-if="entry.kind === 'tool'" class="p-dock-pin"
                        :class="{ on: isDockPinned(entry.item.id) }"
                        :title="isDockPinned(entry.item.id) ? '从 Dock 移除' : '固定到 Dock'"
                        @click.stop="toggleDockPin(entry.item)"
                        @mousedown.stop>⚓</span>
                  <span class="p-type">{{ { tool: entry.item.type?.toUpperCase(), workspace: '空间', command: '命令', resource: '资源' }[entry.kind] }}</span>
                </button>
              </div>
            </template>

            <!-- 空候选:快捷动作 -->
            <div v-else class="p-empty">
              <template v-if="kw">
                <div class="p-empty-ico">🫥</div>
                <p>没有匹配「{{ kw }}」的结果</p>
                <div class="p-empty-btns">
                  <button class="btn btn-primary" @click="goAdd">＋ 添加工具</button>
                  <button class="btn" @click="goNewWs">🎯 新建工作空间</button>
                </div>
              </template>
              <template v-else>
                <div class="p-empty-ico">🧰</div>
                <p>还没有任何工具</p>
                <div class="p-empty-btns">
                  <button class="btn btn-primary" @click="goAdd">＋ 添加工具</button>
                  <button class="btn" @click="goNewWs">🎯 新建工作空间</button>
                </div>
              </template>
            </div>
          </div>

          <!-- 底部快捷键提示 -->
          <div class="p-footer">
            <span><kbd>↑↓</kbd> 选择</span>
            <span><kbd>Enter</kbd> 执行</span>
            <span v-if="!kw || flatResults.some(f => f.kind === 'command')"><kbd>Shift+Enter</kbd> 复制命令</span>
            <span v-if="!kw || flatResults.some(f => f.kind === 'tool')"><kbd>Ctrl+Enter</kbd> 编辑</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.palette-mask {
  position: fixed; inset: 0;
  z-index: 140;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(8px) saturate(1.2);
}
.palette {
  position: absolute;
  top: 20%;
  left: 50%;
  transform: translateX(-50%);
  width: 580px;
  max-width: calc(100vw - 48px);
  border-radius: 18px;
  background: var(--bg-elevated);
  backdrop-filter: blur(36px) saturate(1.7);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.palette.modal-box-enter-from,
.palette.modal-box-leave-to { transform: translateX(-50%) scale(0.96) translateY(8px); }

.p-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--divider);
}
.p-search-ico { font-size: 14px; opacity: 0.6; }
.p-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text-1);
}
.p-input::placeholder { color: var(--text-3); }
.p-esc {
  font-size: 10.5px;
  color: var(--text-3);
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--divider-strong);
}

.p-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 8px;
}
.p-group { margin-bottom: 4px; }
.p-group-label {
  padding: 7px 10px 4px;
  font-size: 11px;
  color: var(--text-3);
  letter-spacing: 0.5px;
}

.p-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border-radius: 10px;
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.p-item.active { background: var(--accent-soft); }
.p-kind-icon {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  font-size: 15px;
  background: var(--bg-input);
  border-radius: 8px;
  flex-shrink: 0;
}
.p-item-main { flex: 1; min-width: 0; }
.p-item-name {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 13.5px; font-weight: 500; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.p-time { font-size: 10.5px; color: var(--text-3); font-weight: 400; flex-shrink: 0; }
.p-item-sub { display: flex; gap: 8px; margin-top: 2px; font-size: 11.5px; color: var(--text-3); }
.p-pin { font-size: 11px; flex-shrink: 0; }
.p-dock-pin {
  flex-shrink: 0;
  width: 22px; height: 22px;
  display: grid; place-items: center;
  font-size: 12px;
  border-radius: 6px;
  color: var(--text-3);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.p-item:hover .p-dock-pin, .p-dock-pin.on { opacity: 0.75; }
.p-dock-pin:hover { opacity: 1; background: var(--bg-input); color: var(--accent); }
.p-dock-pin.on { color: var(--accent); }
.p-type {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 2px 7px;
  border-radius: 20px;
  flex-shrink: 0;
}

.p-empty {
  padding: 36px 0 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 13px;
}
.p-empty-ico { font-size: 40px; }
.p-empty-btns { display: flex; gap: 10px; }

.p-footer {
  display: flex;
  gap: 16px;
  padding: 9px 18px;
  border-top: 1px solid var(--divider);
  font-size: 11px;
  color: var(--text-3);
}
kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-input);
  border: 1px solid var(--divider-strong);
  border-bottom-width: 2px;
  font-family: var(--font);
  font-size: 10px;
  margin-right: 3px;
}
</style>
