<script setup>
// 工作空间新建/重命名弹窗(名称 + emoji + 颜色 + 空间变量)
// v2.1:空间变量(vars)—— 命令模板 {{key}} 渲染最高优先级来源
import { ref, computed, watch, nextTick } from 'vue'
import {
  createWorkspace, updateWorkspace, workspaceById
} from '../stores/workspaceStore'
import { s, toast, persist } from '../composables/store'
import EmojiPicker from './EmojiPicker.vue'

const qd = window.qd

const isEdit = computed(() => !!s.wsModal.editId)
const editing = computed(() => isEdit.value ? workspaceById(s.wsModal.editId) : null)

const form = ref(defaultForm())
const nameInvalid = ref(false)
const nameRef = ref(null)
const showEmojiPicker = ref(false)

// 空间变量编辑行:[key, value](用数组便于 v-model)
const varRows = ref([])

function defaultForm() {
  return { name: '', emoji: '🎯', color: '#4F8CFF' }
}

const QUICK_EMOJIS = ['🎯', '🛡️', '🌐', '💻', '🧪', '🔍', '⚔️', '🚀']
const QUICK_COLORS = ['#4F8CFF', '#E05F5F', '#34B3A0', '#E8A33D', '#8C6FFF', '#E2669B']

watch(() => s.wsModal.open, (open) => {
  if (!open) return
  nameInvalid.value = false
  showEmojiPicker.value = false
  if (editing.value) {
    form.value = {
      name: editing.value.name,
      emoji: editing.value.emoji || '🎯',
      color: editing.value.color || '#4F8CFF'
    }
    // v2.1:载入空间变量
    varRows.value = Object.entries(editing.value.vars || {}).map(([key, value]) => ({ key, value }))
  } else {
    form.value = defaultForm()
    varRows.value = []
  }
  nextTick(() => nameRef.value?.focus())
})

/* ---- 空间变量编辑 ---- */
function addVarRow() { varRows.value.push({ key: '', value: '' }) }
function delVarRow(i) { varRows.value.splice(i, 1) }

// rows → vars 对象(空 key 行丢弃;后行覆盖前行同 key)
function rowsToVars() {
  const vars = {}
  for (const r of varRows.value) {
    const k = String(r.key || '').trim()
    if (k) vars[k] = String(r.value ?? '')
  }
  return vars
}

async function save() {
  const f = form.value
  nameInvalid.value = !f.name.trim()
  if (nameInvalid.value) { toast('请填写工作空间名称', 'error'); return }
  if (isEdit.value) {
    await updateWorkspace(s.wsModal.editId, {
      name: f.name.trim(), emoji: f.emoji, color: f.color,
      vars: rowsToVars()                       // v2.1:空间变量一并保存
    })
    persist()
    toast(`工作空间「${f.name.trim()}」已保存`, 'success')
  } else {
    const created = await createWorkspace({
      name: f.name.trim(), emoji: f.emoji, color: f.color
    })
    // 新建路径:create IPC 不收 vars;创建后立即补写一次
    const vars = rowsToVars()
    if (Object.keys(vars).length) await updateWorkspace(created.id, { vars })
    persist()
    toast(`工作空间「${created.name}」已创建`, 'success')
  }
  s.wsModal.open = false
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.wsModal.open" class="mask" @mousedown.self="s.wsModal.open = false">
      <Transition name="modal-box" appear>
        <div class="box">
          <h3 class="title">{{ isEdit ? '编辑工作空间' : '新建工作空间' }}</h3>
          <p class="sub">工作空间 = 一次渗透任务的全部上下文:工具组合、项目目录、目标变量。进入空间不会自动启动任何工具。</p>

          <div class="field-row">
            <div class="field grow">
              <label class="label">名称 <i class="req">*</i></label>
              <input ref="nameRef" v-model="form.name" class="input" :class="{ invalid: nameInvalid }"
                     placeholder="如:客户A 渗透测试" maxlength="20"
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
                        :class="{ on: form.emoji === e }"
                        @click="form.emoji = e; showEmojiPicker = false">{{ e }}</button>
              </div>
              <EmojiPicker @select="e => { form.emoji = e; showEmojiPicker = false }" />
            </div>
          </Transition>

          <div class="field">
            <label class="label">颜色标识</label>
            <div class="color-row">
              <button v-for="c in QUICK_COLORS" :key="c" class="color-dot"
                      :class="{ on: form.color === c }"
                      :style="{ background: c }"
                      @click="form.color = c"></button>
            </div>
          </div>

          <!-- v2.1:空间变量(命令模板 {{key}} 的最高优先级来源) -->
          <div class="field">
            <label class="label">空间变量 <span class="label-tip">命令模板里双花括号变量的最高优先级取值</span></label>
            <div v-for="(r, i) in varRows" :key="i" class="var-row">
              <input v-model="r.key" class="input var-k mono" placeholder="变量名" spellcheck="false" />
              <span class="var-eq">=</span>
              <input v-model="r.value" class="input var-v mono" placeholder="值" spellcheck="false" />
              <button type="button" class="var-del" title="删除变量" @click="delVarRow(i)">✕</button>
            </div>
            <button type="button" class="var-add" @click="addVarRow">＋ 添加变量</button>
          </div>

          <div class="actions">
            <button class="btn" @click="s.wsModal.open = false">取消</button>
            <button class="btn btn-primary" @click="save">{{ isEdit ? '保存' : '创建' }}</button>
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
  width: 440px;
  max-width: calc(100vw - 48px);
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
.grow { flex: 1; }
.label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 6px; font-weight: 500; }
.req { color: var(--danger); font-style: normal; }

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

.color-row { display: flex; gap: 10px; }
.color-dot {
  width: 26px; height: 26px;
  border-radius: 50%;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.color-dot:hover { transform: scale(1.12); }
.color-dot.on { box-shadow: 0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--accent); }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}

/* v2.1 空间变量编辑 */
.label-tip { font-size: 11px; color: var(--text-3); font-weight: 400; }
.mono { font-family: Consolas, monospace; }
.var-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.var-k { flex: 0 0 150px; }
.var-eq { color: var(--text-3); flex-shrink: 0; }
.var-v { flex: 1; }
.var-del {
  width: 24px; height: 24px;
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-3);
  flex-shrink: 0;
}
.var-del:hover { background: rgba(255, 93, 93, 0.12); color: var(--danger); }
.var-add {
  font-size: 11.5px;
  color: var(--text-3);
  padding: 4px 10px;
  border-radius: var(--radius-btn);
  border: 1px dashed var(--divider-strong);
  margin-top: 2px;
  transition: all var(--dur-fast) var(--ease);
}
.var-add:hover { color: var(--accent); border-color: var(--accent); }
</style>
