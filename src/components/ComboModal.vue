<script setup>
// 工具组合创建/编辑弹窗(一键工作环境)
// 名称 / emoji 图标 / 从工具库多选勾选成员 / 保存后可在侧边栏一键启动
import { ref, computed, watch, nextTick } from 'vue'
import {
  s, toolById, comboById, addCombo, updateCombo, sortedCategories, toast, persist
} from '../composables/store'
import EmojiPicker from './EmojiPicker.vue'
import ToolIcon from './ToolIcon.vue'

const isEdit = computed(() => !!s.comboModal.editId)
const editing = computed(() => isEdit.value ? comboById(s.comboModal.editId) : null)

/* ---- 表单状态 ---- */
const form = ref(defaultForm())
const nameInvalid = ref(false)
const nameRef = ref(null)
const filter = ref('')
const showEmojiPicker = ref(false)

function defaultForm() {
  return { name: '', emoji: '⚡', toolIds: [] }
}

// 打开时填充(编辑取已有组合;新建默认空表单)
watch(() => s.comboModal.open, (open) => {
  if (!open) return
  nameInvalid.value = false
  filter.value = ''
  showEmojiPicker.value = false
  if (editing.value) {
    form.value = {
      name: editing.value.name,
      emoji: editing.value.emoji || '⚡',
      toolIds: [...(editing.value.toolIds || [])]
    }
  } else {
    form.value = defaultForm()
  }
  nextTick(() => nameRef.value?.focus())
})

/* ---- 工具选择:按分类分组展示,支持名称过滤 ---- */
const QUICK_EMOJIS = ['⚡', '🚀', '💻', '🌐', '🛡️', '🧪', '📊', '🎯']

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

function toggle(toolId) {
  const i = form.value.toolIds.indexOf(toolId)
  if (i > -1) form.value.toolIds.splice(i, 1)
  else form.value.toolIds.push(toolId)
}

function isSelected(toolId) {
  return form.value.toolIds.includes(toolId)
}

// 当前视图工具一键全选(新建组合时快速圈定范围)
function selectAllVisible() {
  const ids = groups.value.flatMap(g => g.tools.map(t => t.id))
  const all = ids.every(id => form.value.toolIds.includes(id))
  if (all) form.value.toolIds = form.value.toolIds.filter(id => !ids.includes(id))
  else form.value.toolIds = [...new Set([...form.value.toolIds, ...ids])]
}

/* ---- 保存 ---- */
function save() {
  const f = form.value
  nameInvalid.value = !f.name.trim()
  if (nameInvalid.value) { toast('请填写组合名称', 'error'); return }
  if (!f.toolIds.length) { toast('请至少勾选一个工具', 'error'); return }
  const payload = { name: f.name.trim(), emoji: f.emoji, toolIds: f.toolIds }
  if (isEdit.value) {
    updateCombo(s.comboModal.editId, payload)
    toast(`组合「${payload.name}」已保存`, 'success')
  } else {
    addCombo(payload)
    toast(`组合「${payload.name}」已创建,点击侧边栏即可一键启动`, 'success')
  }
  persist(true)
  s.comboModal.open = false
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.comboModal.open" class="mask" @mousedown.self="s.comboModal.open = false">
      <Transition name="modal-box" appear>
        <div class="box">
          <h3 class="title">{{ isEdit ? '编辑组合' : '新建组合' }}</h3>
          <p class="sub">组合 = 一键启动的工作环境。例如「开发环境」:VS Code + Node + Chrome + Postman,点一下全部拉起。</p>

          <!-- 名称 + emoji -->
          <div class="field-row">
            <div class="field grow">
              <label class="label">组合名称 <i class="req">*</i></label>
              <input ref="nameRef" v-model="form.name" class="input" :class="{ invalid: nameInvalid }"
                     placeholder="如:Web 开发环境" maxlength="20"
                     @keydown.enter="save" />
            </div>
            <div class="field">
              <label class="label">图标</label>
              <button type="button" class="emoji-btn" @click="showEmojiPicker = !showEmojiPicker">
                {{ form.emoji }}
              </button>
            </div>
          </div>
          <Transition name="fade">
            <div v-if="showEmojiPicker" class="emoji-wrap">
              <div class="quick-emojis">
                <button v-for="e in QUICK_EMOJIS" :key="e" class="q-emoji"
                        :class="{ on: form.emoji === e }" @click="form.emoji = e; showEmojiPicker = false">{{ e }}</button>
              </div>
              <EmojiPicker @select="e => { form.emoji = e; showEmojiPicker = false }" />
            </div>
          </Transition>

          <!-- 成员选择 -->
          <div class="field">
            <div class="pick-head">
              <label class="label">选择工具 <i class="req">*</i></label>
              <div class="pick-meta">
                <span class="picked-count" :class="{ some: form.toolIds.length > 0 }">已选 {{ form.toolIds.length }}</span>
                <button class="mini-btn" @click="selectAllVisible">全选 / 反选</button>
              </div>
            </div>
            <div class="filter-wrap">
              <span class="f-ico">🔍</span>
              <input v-model="filter" class="input filter-input" placeholder="过滤工具名称" />
            </div>
            <div class="tool-list scroll-area">
              <div v-for="g in groups" :key="g.key" class="pick-group">
                <div class="pg-label">{{ g.emoji }} {{ g.name }}</div>
                <button v-for="t in g.tools" :key="t.id" type="button"
                        class="pick-item" :class="{ on: isSelected(t.id) }"
                        @click="toggle(t.id)">
                  <span class="chk">{{ isSelected(t.id) ? '✓' : '' }}</span>
                  <ToolIcon :tool="t" :size="18" />
                  <span class="pi-name">{{ t.name }}</span>
                  <span class="pi-desc">{{ t.desc || t.type.toUpperCase() }}</span>
                </button>
                <div v-if="!g.tools.length" class="pg-empty">无匹配工具</div>
              </div>
              <div v-if="!s.data.tools.length" class="pg-empty big">工具库还是空的,先添加工具再创建组合</div>
            </div>
            <p class="hint">启动顺序 = 勾选顺序;组合启动时按顺序串行拉起(间隔 0.4s)</p>
          </div>

          <!-- 操作 -->
          <div class="actions">
            <button class="btn" @click="s.comboModal.open = false">取消</button>
            <button class="btn btn-primary" @click="save">{{ isEdit ? '保存' : '创建组合' }}</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 110;
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
}
.title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
.sub { font-size: 12px; color: var(--text-3); line-height: 1.6; margin-bottom: 16px; }

.field { margin-bottom: 12px; }
.field-row { display: flex; gap: 14px; align-items: flex-end; }
.field-row .field { margin-bottom: 12px; }
.grow { flex: 1; }

.label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 6px;
  font-weight: 500;
}
.req { color: var(--danger); font-style: normal; }
.hint { margin-top: 8px; font-size: 11.5px; color: var(--text-3); }

.emoji-btn {
  width: 46px; height: 34px;
  font-size: 18px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.emoji-btn:hover { background: var(--bg-input-hover); }

.emoji-wrap { margin: -6px 0 12px; display: flex; flex-direction: column; gap: 8px; }
.quick-emojis { display: flex; gap: 6px; }
.q-emoji {
  width: 34px; height: 30px;
  font-size: 15px;
  border-radius: 8px;
  background: var(--bg-input);
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.q-emoji:hover { background: var(--bg-input-hover); transform: scale(1.08); }
.q-emoji.on { background: var(--accent-soft); box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.4); }

.pick-head { display: flex; align-items: center; justify-content: space-between; }
.pick-meta { display: flex; align-items: center; gap: 8px; }
.picked-count {
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-input);
  font-variant-numeric: tabular-nums;
}
.picked-count.some { color: var(--accent); background: var(--accent-soft); }
.mini-btn {
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 8px;
  border-radius: 8px;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.mini-btn:hover { background: var(--bg-input); color: var(--text-1); }

.filter-wrap { position: relative; margin-bottom: 8px; }
.f-ico {
  position: absolute; left: 9px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px; opacity: 0.6; pointer-events: none;
}
.filter-input { height: 30px; padding: 0 10px 0 26px; font-size: 12px; }

.tool-list {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--divider);
  border-radius: var(--radius-btn);
  padding: 6px;
  background: var(--bg-input);
}
.pick-group { margin-bottom: 6px; }
.pick-group:last-child { margin-bottom: 0; }
.pg-label {
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 6px;
  letter-spacing: 0.5px;
}
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
.pick-item:hover { background: var(--bg-card-hover); }
.pick-item.on { background: var(--accent-soft); box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.3); }
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
}
</style>
