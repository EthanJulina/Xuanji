<script setup>
// 工具卡片:图标 + 名称 + 备注 + 分类标签
// hover 上浮 2px / 按压 scale(0.97) / 置顶图钉 / 运行脉冲点 / ⋯ 菜单 / 手动拖拽排序
// v2.0:⋯ 菜单新增「以配置运行」子菜单(列出全部 launchConfig)与「添加到工作空间」
import { computed } from 'vue'
import {
  s, askRun, categoryById, togglePin, openContextMenu, isRunning,
  updateTool, removeTool, toast, reorderTools, persist, relativeTime, setView
} from '../composables/store'
import { listConfigs } from '../stores/launchConfigStore'
import { isDockPinned, toggleDockPin } from '../stores/dockStore'
import { sortedWorkspaces, addToolsToWorkspace } from '../stores/workspaceStore'
import ToolIcon from './ToolIcon.vue'

const props = defineProps({
  tool: { type: Object, required: true },
  index: { type: Number, default: 0 },
  showLastRun: { type: Boolean, default: false }   // 最近使用视图:显示相对时间
})

const qd = window.qd
const cat = computed(() => categoryById(props.tool.categoryId))
const running = computed(() => isRunning(props.tool.id))

/* ---- 右上角 ⋯ 菜单 ---- */
function moreMenu(e) {
  const items = [
    { icon: '✏️', label: '编辑', action: () => { s.toolModal.open = true; s.toolModal.editId = props.tool.id; s.toolModal.tab = 'basic' } },
    { icon: '📌', label: props.tool.pinned ? '取消置顶' : '置顶', action: () => togglePin(props.tool) },
    // v2.1:Dock 固定(与星标置顶是两套独立机制)
    { icon: '⚓', label: isDockPinned(props.tool.id) ? '从 Dock 移除' : '固定到 Dock', action: () => toggleDockPin(props.tool) },
    { icon: '📂', label: '打开所在目录', action: () => qd.showInFolder(props.tool.targetPath) },
    { icon: '📋', label: '查看日志', action: () => { s.logPanel.open = true; s.logPanel.toolId = props.tool.id } },
    // v2.1:跳转日志中心并自动过滤到该工具(落盘日志,支持等级/时间/关键字过滤)
    { icon: '🗂', label: '在日志中心打开', action: () => setView({ type: 'logcenter', id: props.tool.id }) }
  ]
  // 以配置运行:有 ≥2 条配置时才值得列出(单条 = 默认行为)
  const configs = listConfigs(props.tool)
  if (configs.length > 1) {
    for (const c of configs) {
      const isActive = c.id === props.tool.activeLaunchConfigId
      items.push({
        icon: isActive ? '✅' : '▶️',
        label: `以「${c.name}」运行`,
        action: () => askRun(props.tool, c.id)
      })
    }
  }
  // 添加到工作空间:存在至少一个空间时提供
  if (sortedWorkspaces.value.length) {
    for (const w of sortedWorkspaces.value.slice(0, 4)) {
      const already = (w.toolIds || []).includes(props.tool.id)
      items.push({
        icon: w.emoji || '🎯',
        label: `${already ? '已在' : '加入'}「${w.name}」`,
        action: async () => {
          if (already) { toast(`已在工作空间「${w.name}」中`, 'info'); return }
          await addToolsToWorkspace(w.id, [props.tool.id])
          persist()
          toast(`已加入「${w.name}」`, 'success')
        }
      })
    }
  }
  items.push({ icon: '🗑', label: '删除', danger: true, action: () => { s.deleteModal.open = true; s.deleteModal.tool = props.tool } })
  openContextMenu(e, items)
}

/* ---- 手动排序:HTML5 拖拽(仅手动模式 + 同分类) ---- */
const manual = computed(() => s.data.settings.sortMode === 'manual')

function onDragStart(e) {
  if (!manual.value) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/qd-tool', props.tool.id)
  s.drag = { toolId: props.tool.id, categoryId: props.tool.categoryId, overId: null, pos: null }
}
function onDragOver(e) {
  const drag = s.drag
  if (!drag || !manual.value) return
  if (drag.categoryId !== props.tool.categoryId) return   // 仅同分类内
  e.preventDefault()
  const rect = e.currentTarget.getBoundingClientRect()
  drag.pos = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after'
  drag.overId = props.tool.id
}
function onDragEnd() { s.drag = null }
function onDrop(e) {
  const drag = s.drag
  if (!drag || !manual.value || drag.overId === null) return
  // 计算组内新顺序
  const groupIds = s.data.tools
    .filter(t => t.categoryId === drag.categoryId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(t => t.id)
  const from = groupIds.indexOf(drag.toolId)
  let to = groupIds.indexOf(drag.overId)
  if (from === -1 || to === -1) return
  const [moved] = groupIds.splice(from, 1)
  if (from < to) to -= 1
  groupIds.splice(drag.pos === 'before' ? to : to + 1, 0, moved)
  reorderTools(drag.categoryId, groupIds)
  s.drag = null
}

const dragClass = computed(() => {
  const drag = s.drag
  if (!drag) return {}
  return {
    dragging: drag.toolId === props.tool.id,
    'drop-before': drag.overId === props.tool.id && drag.pos === 'before' && drag.toolId !== props.tool.id,
    'drop-after': drag.overId === props.tool.id && drag.pos === 'after' && drag.toolId !== props.tool.id
  }
})

/* ---- 删除入口(供空态等复用) ---- */
function openEdit() {
  s.toolModal.open = true
  s.toolModal.editId = props.tool.id
}
</script>

<template>
  <div class="tool-card hover-lift press enter-item"
       :class="dragClass"
       :style="{ '--i': Math.min(index, 20) }"
       :draggable="manual"
       @dragstart="onDragStart"
       @dragover="onDragOver"
       @dragend="onDragEnd"
       @drop="onDrop"
       @click="askRun(tool)"
       @contextmenu="(e) => moreMenu(e)"
       tabindex="0"
       @keydown.enter="askRun(tool)"
       :title="tool.targetPath">
    <!-- 置顶图钉 -->
    <span v-if="tool.pinned" class="pin" title="已置顶">📌</span>

    <!-- 右上角 ⋯ -->
    <button class="more no-drag" title="更多操作" @click.stop="moreMenu($event)">⋯</button>

    <div class="card-main">
      <ToolIcon :tool="tool" :size="40" />
      <div class="card-info">
        <div class="name-row">
          <span class="name ellipsis">{{ tool.name }}</span>
          <span v-if="running" class="run-dot" title="运行中"></span>
        </div>
        <div class="desc ellipsis">{{ tool.desc || '无备注' }}</div>
        <div class="meta-row">
          <span v-if="showLastRun && tool.lastRunAt" class="last-run" title="上次启动">🕘 {{ relativeTime(tool.lastRunAt) }}</span>
          <span v-if="cat" class="cat-tag">
            <span>{{ cat.emoji }}</span>{{ cat.name }}
          </span>
          <span class="type-tag">{{ tool.type.toUpperCase() }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  position: relative;
  padding: 14px;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  box-shadow: var(--shadow-card), inset 0 0 0 1px var(--divider);
  cursor: pointer;
  overflow: hidden;
}
.tool-card:hover {
  background: var(--bg-card-hover);
  box-shadow: var(--shadow-card-hover), inset 0 0 0 1px var(--divider-strong);
}

/* 拖拽状态 */
.tool-card.dragging { opacity: 0.45; }
.tool-card.drop-before { box-shadow: 0 -2px 0 0 var(--accent), var(--shadow-card); }
.tool-card.drop-after { box-shadow: 0 2px 0 0 var(--accent), var(--shadow-card); }

.pin {
  position: absolute;
  top: 8px; left: 10px;
  font-size: 11px;
  opacity: 0.75;
  transform: rotate(-15deg);
}

.more {
  position: absolute;
  top: 8px; right: 8px;
  width: 24px; height: 24px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1;
  color: var(--text-3);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.tool-card:hover .more { opacity: 1; }
.more:hover { background: var(--bg-card-hover); color: var(--text-1); }
.more:active { transform: scale(0.9); }

.card-main { display: flex; gap: 12px; align-items: flex-start; }
.card-info { flex: 1; min-width: 0; }

.name-row { display: flex; align-items: center; gap: 6px; }
.name { font-size: 13.5px; font-weight: 600; color: var(--text-1); max-width: calc(100% - 20px); }
.run-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  animation: pulse-dot 1.8s infinite;
}

.desc {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-2);
  min-height: 17px;
}

.meta-row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
.cat-tag, .type-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--bg-input);
  color: var(--text-3);
}
.type-tag { font-weight: 600; letter-spacing: 0.5px; }
.last-run {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
</style>
