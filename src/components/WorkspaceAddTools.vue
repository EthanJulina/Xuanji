<script setup>
// 从工具库多选添加工具到工作空间
// 按分类分组展示 + 名称过滤(复用组合弹窗的交互模式)
import { ref, computed, watch } from 'vue'
import {
  ws, workspaceById, addToolsToWorkspace
} from '../stores/workspaceStore'
import { s, sortedCategories, toolById, toast, persist } from '../composables/store'
import ToolIcon from './ToolIcon.vue'

const filter = ref('')
const picked = ref([])

watch(() => s.wsAddTools.open, (open) => {
  if (!open) return
  filter.value = ''
  picked.value = []
})

const groups = computed(() => {
  const q = filter.value.trim().toLowerCase()
  const list = s.data.tools
  const out = []
  for (const cat of sortedCategories.value) {
    const tools = list.filter(t => t.categoryId === cat.id && (!q || t.name.toLowerCase().includes(q)))
    if (tools.length) out.push({ key: cat.id, name: cat.name, emoji: cat.emoji, tools })
  }
  const uncat = list.filter(t => !t.categoryId && (!q || t.name.toLowerCase().includes(q)))
  if (uncat.length || !q) out.push({ key: '__uncat', name: '未分类', emoji: '📥', tools: uncat })
  return out
})

// 当前空间里已有的工具(置灰不可再选)
const existingIds = computed(() => new Set(workspaceById(s.wsAddTools.workspaceId)?.toolIds || []))

function toggle(toolId) {
  const i = picked.value.indexOf(toolId)
  if (i > -1) picked.value.splice(i, 1)
  else picked.value.push(toolId)
}

async function confirmAdd() {
  if (!picked.value.length) { toast('请先勾选工具', 'error'); return }
  await addToolsToWorkspace(s.wsAddTools.workspaceId, picked.value)
  persist()
  toast(`已添加 ${picked.value.length} 个工具到工作空间`, 'success')
  s.wsAddTools.open = false
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.wsAddTools.open" class="mask" @mousedown.self="s.wsAddTools.open = false">
      <Transition name="modal-box" appear>
        <div class="box">
          <h3 class="title">添加工具到工作空间</h3>
          <p class="sub">工具仅被「引用」,不会被复制;在空间内移除也不影响工具库。</p>

          <div class="filter-wrap">
            <span class="f-ico">🔍</span>
            <input v-model="filter" class="input filter-input" placeholder="过滤工具名称" />
            <span class="picked-count" :class="{ some: picked.length > 0 }">已选 {{ picked.length }}</span>
          </div>

          <div class="tool-list scroll-area">
            <div v-for="g in groups" :key="g.key" class="pick-group">
              <div class="pg-label">{{ g.emoji }} {{ g.name }}</div>
              <button v-for="t in g.tools" :key="t.id" type="button"
                      class="pick-item" :class="{ on: picked.includes(t.id), exists: existingIds.has(t.id) }"
                      :disabled="existingIds.has(t.id)"
                      @click="toggle(t.id)">
                <span class="chk">{{ picked.includes(t.id) ? '✓' : '' }}</span>
                <ToolIcon :tool="t" :size="18" />
                <span class="pi-name">{{ t.name }}</span>
                <span class="pi-desc">{{ existingIds.has(t.id) ? '已在空间内' : (t.desc || t.type.toUpperCase()) }}</span>
              </button>
              <div v-if="!g.tools.length" class="pg-empty">无匹配工具</div>
            </div>
            <div v-if="!s.data.tools.length" class="pg-empty big">工具库还是空的,先去添加工具</div>
          </div>

          <div class="actions">
            <button class="btn" @click="s.wsAddTools.open = false">取消</button>
            <button class="btn btn-primary" @click="confirmAdd">添加所选</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 112;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.2);
  display: grid; place-items: center;
}
.box {
  width: 520px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(32px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
}
.title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.sub { font-size: 12px; color: var(--text-3); line-height: 1.6; margin-bottom: 14px; }

.filter-wrap { position: relative; margin-bottom: 8px; flex-shrink: 0; }
.f-ico {
  position: absolute; left: 9px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px; opacity: 0.6; pointer-events: none;
}
.filter-input { height: 30px; padding: 0 86px 0 26px; font-size: 12px; }
.picked-count {
  position: absolute; right: 8px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-input);
  font-variant-numeric: tabular-nums;
}
.picked-count.some { color: var(--accent); background: var(--accent-soft); }

.tool-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--divider);
  border-radius: var(--radius-btn);
  padding: 6px;
  background: var(--bg-input);
  flex: 1;
  min-height: 120px;
}
.pick-group { margin-bottom: 6px; }
.pick-group:last-child { margin-bottom: 0; }
.pg-label { font-size: 11px; color: var(--text-3); padding: 4px 6px; letter-spacing: 0.5px; }
.pg-empty { font-size: 11.5px; color: var(--text-3); padding: 8px 6px; text-align: center; }
.pg-empty.big { padding: 26px 6px; }

.pick-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  text-align: left;
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.pick-item:hover:not(:disabled) { background: var(--bg-card-hover); }
.pick-item.on { background: var(--accent-soft); box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.3); }
.pick-item.exists { opacity: 0.45; cursor: not-allowed; }
.chk {
  width: 16px; height: 16px;
  border-radius: 5px;
  border: 1px solid var(--divider-strong);
  background: var(--bg-elevated);
  font-size: 10px;
  color: var(--accent);
  display: grid; place-items: center;
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.pick-item.on .chk { background: var(--accent); border-color: var(--accent); color: #fff; }
.pi-name {
  font-size: 12.5px;
  color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 40%;
}
.pi-desc {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
  flex-shrink: 0;
}
</style>
