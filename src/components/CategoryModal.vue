<script setup>
// 分类管理弹窗:重命名 / 更换 emoji+颜色 / 拖拽排序 / 删除(工具移入未分类)
import { ref, computed } from 'vue'
import {
  s, sortedCategories, countOfCategory, addCategory, updateCategory,
  removeCategory, reorderCategories, toast, confirmBox
} from '../composables/store'
import EmojiPicker from './EmojiPicker.vue'

const COLORS = ['#4F8CFF', '#8C6FFF', '#34B3A0', '#E8A33D', '#E2669B', '#5FA7E0', '#7E6BE0', '#E05F5F', '#59C178', '#9AA4B2']
const showEmojiFor = ref(null)     // 正在换 emoji 的分类 id
const dragId = ref(null)
const overId = ref(null)
const newName = ref('')
const newEmoji = ref('📁')
const newColor = ref('#4F8CFF')
const creating = ref(false)

const list = computed(() => sortedCategories.value)

function rename(cat, e) {
  const name = e.target.textContent?.trim()
  if (name && name !== cat.name) {
    updateCategory(cat.id, { name })
    toast('分类已重命名', 'success')
  }
}

function pickColor(cat, color) {
  updateCategory(cat.id, { color })
}

function pickEmoji(cat, emoji) {
  updateCategory(cat.id, { emoji })
  showEmojiFor.value = null
}

/* ---- 拖拽排序 ---- */
function onDragStart(id) { dragId.value = id }
function onDragOver(id, e) {
  e.preventDefault()
  overId.value = id
}
function onDrop() {
  if (!dragId.value || dragId.value === overId.value) { dragId.value = null; overId.value = null; return }
  const ids = list.value.map(c => c.id)
  const from = ids.indexOf(dragId.value)
  const to = ids.indexOf(overId.value)
  if (from > -1 && to > -1) {
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderCategories(ids)
  }
  dragId.value = null
  overId.value = null
}

/* ---- 新建 ---- */
function create() {
  const name = newName.value.trim()
  if (!name) { toast('请输入分类名称', 'error'); return }
  addCategory({ name, emoji: newEmoji.value, color: newColor.value })
  toast(`分类「${name}」已创建`, 'success')
  newName.value = ''
  creating.value = false
}

/* ---- 删除 ---- */
async function del(cat) {
  const n = countOfCategory(cat.id)
  const yes = await confirmBox({
    title: '删除分类',
    message: `确定删除分类「${cat.emoji} ${cat.name}」吗?`,
    detail: `分类下的 ${n} 个工具会移入「未分类」,不会删除工具本身。`,
    confirmText: '删除'
  })
  if (yes) {
    removeCategory(cat.id)
    toast('分类已删除,工具已移入未分类', 'success')
  }
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.catModal.open" class="mask" @mousedown.self="s.catModal.open = false">
      <Transition name="modal-box" appear>
        <div class="box scroll-area">
          <h3 class="title">管理分类</h3>
          <p class="sub">拖动分类卡片可调整侧边栏顺序;点击名称可直接编辑</p>

          <!-- 分类列表 -->
          <div class="cat-list">
            <div v-for="cat in list" :key="cat.id"
                 class="cat-row"
                 :class="{ dragging: dragId === cat.id, 'drop-line': overId === cat.id && dragId && dragId !== cat.id }"
                 draggable="true"
                 @dragstart="onDragStart(cat.id)"
                 @dragover="onDragOver(cat.id, $event)"
                 @drop="onDrop" @dragend="onDrop">
              <!-- 拖拽把手 -->
              <span class="handle">⠿</span>

              <!-- emoji 按钮(点击换) -->
              <button class="cat-emoji" @click="showEmojiFor = showEmojiFor === cat.id ? null : cat.id"
                      :style="{ background: cat.color + '26' }" title="点击更换图标">
                {{ cat.emoji }}
              </button>

              <!-- 名称(contenteditable 直接改) -->
              <span class="cat-name" contenteditable="true" spellcheck="false"
                    @keydown.enter.prevent="$event.target.blur()"
                    @blur="rename(cat, $event)">{{ cat.name }}</span>

              <span class="cat-count">{{ countOfCategory(cat.id) }} 个工具</span>

              <!-- 色板 -->
              <div class="color-dots">
                <button v-for="c in COLORS" :key="c" class="c-dot"
                        :class="{ on: cat.color === c }"
                        :style="{ background: c }"
                        @click="pickColor(cat, c)"></button>
              </div>

              <button class="del-btn" title="删除分类" @click="del(cat)">🗑</button>

              <!-- emoji 选择浮层 -->
              <div v-if="showEmojiFor === cat.id" class="emoji-pop">
                <EmojiPicker @select="e => pickEmoji(cat, e)" />
              </div>
            </div>
          </div>

          <!-- 新建分类 -->
          <div class="create-area">
            <button v-if="!creating" class="btn create-btn" @click="creating = true">➕ 新建分类</button>
            <div v-else class="create-row">
              <button class="cat-emoji big" @click="null">{{ newEmoji }}</button>
              <input v-model="newName" class="input grow" placeholder="分类名称" maxlength="16"
                     @keydown.enter="create" ref="newInput" />
              <div class="color-dots">
                <button v-for="c in COLORS.slice(0, 6)" :key="c" class="c-dot"
                        :class="{ on: newColor === c }" :style="{ background: c }"
                        @click="newColor = c"></button>
              </div>
              <button class="btn btn-primary" @click="create">创建</button>
              <button class="btn btn-ghost" @click="creating = false">取消</button>
            </div>
          </div>

          <div class="actions">
            <button class="btn btn-primary" @click="s.catModal.open = false">完成</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 115;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.2);
  display: grid; place-items: center;
}
.box {
  width: 620px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(32px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 22px 24px;
}
.title { font-size: 16px; font-weight: 600; }
.sub { font-size: 12px; color: var(--text-3); margin: 6px 0 16px; }

.cat-list { display: flex; flex-direction: column; gap: 6px; }
.cat-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--bg-card);
  box-shadow: inset 0 0 0 1px var(--divider);
  transition: box-shadow var(--dur-fast) var(--ease), opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.cat-row:hover { box-shadow: inset 0 0 0 1px var(--divider-strong); }
.cat-row.dragging { opacity: 0.4; }
.cat-row.drop-line { box-shadow: 0 -2px 0 0 var(--accent), inset 0 0 0 1px var(--divider); }

.handle { color: var(--text-3); cursor: grab; font-size: 13px; padding: 0 2px; }
.cat-emoji {
  width: 32px; height: 32px;
  border-radius: 8px;
  font-size: 16px;
  display: grid; place-items: center;
  transition: transform var(--dur-fast) var(--ease);
  flex-shrink: 0;
}
.cat-emoji:hover { transform: scale(1.12); }
.cat-emoji.big { background: var(--bg-input); }
.cat-name {
  font-size: 13px;
  color: var(--text-1);
  padding: 3px 7px;
  border-radius: 5px;
  min-width: 60px;
  outline: none;
  transition: background var(--dur-fast) var(--ease);
}
.cat-name:hover { background: var(--bg-input); }
.cat-name:focus { background: var(--bg-input); box-shadow: 0 0 0 2px var(--accent-soft); }
.cat-count { font-size: 11px; color: var(--text-3); white-space: nowrap; }

.color-dots { display: flex; gap: 5px; margin-left: auto; }
.c-dot {
  width: 14px; height: 14px;
  border-radius: 50%;
  transition: transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.c-dot:hover { transform: scale(1.25); }
.c-dot.on { box-shadow: 0 0 0 2px var(--bg-elevated), 0 0 0 3.5px var(--text-3); }

.del-btn {
  width: 28px; height: 28px;
  border-radius: 7px;
  font-size: 13px;
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.del-btn:hover { opacity: 1; background: var(--danger-soft); }
.del-btn:active { transform: scale(0.9); }

.emoji-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 40px;
  z-index: 20;
  background: var(--bg-elevated);
  border-radius: 12px;
  box-shadow: var(--shadow-pop), inset 0 0 0 1px var(--divider);
}

.create-area { margin-top: 14px; }
.create-btn { width: 100%; border-style: dashed; border: 1px dashed var(--divider-strong); height: 38px; }
.create-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
</style>
