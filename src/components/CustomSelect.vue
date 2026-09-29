<script setup>
// 自定义下拉选择(替换原生 select):支持新建选项、键盘操作
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: null },
  options: { type: Array, default: () => [] },   // [{ value, label, emoji }]
  placeholder: { type: String, default: '请选择' },
  allowNew: { type: Boolean, default: false }    // 提供「新建分类」内联输入
})
const emit = defineEmits(['update:modelValue', 'create'])

const open = ref(false)
const activeIdx = ref(-1)
const newMode = ref(false)
const newName = ref('')
const root = ref(null)
const inputRef = ref(null)

const current = computed(() => props.options.find(o => o.value === props.modelValue))

function toggle() {
  open.value = !open.value
  if (open.value) {
    activeIdx.value = props.options.findIndex(o => o.value === props.modelValue)
    newMode.value = false
  }
}

function pick(o) {
  if (o.value === '__new') {
    newMode.value = true
    nextTick(() => inputRef.value?.focus())
    return
  }
  emit('update:modelValue', o.value)
  open.value = false
}

function createNew() {
  const name = newName.value.trim()
  if (!name) return
  emit('create', name)
  newName.value = ''
  newMode.value = false
  open.value = false
}

function onKey(e) {
  if (!open.value) return
  const len = props.options.length
  if (e.key === 'Escape') { open.value = false; e.stopPropagation() }
  if (e.key === 'ArrowDown') { activeIdx.value = (activeIdx.value + 1) % len; e.preventDefault() }
  if (e.key === 'ArrowUp') { activeIdx.value = (activeIdx.value - 1 + len) % len; e.preventDefault() }
  if (e.key === 'Enter' && !newMode.value && activeIdx.value > -1) { pick(props.options[activeIdx.value]); e.preventDefault() }
  if (e.key === 'Enter' && newMode.value) { createNew(); e.preventDefault() }
}

function onOutside(e) { if (root.value && !root.value.contains(e.target)) open.value = false }
onMounted(() => window.addEventListener('mousedown', onOutside))
onUnmounted(() => window.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="root" class="qd-select" @keydown="onKey">
    <button type="button" class="trigger input" @click="toggle">
      <span v-if="current" class="label">
        <span v-if="current.emoji" class="o-emoji">{{ current.emoji }}</span>{{ current.label }}
      </span>
      <span v-else class="ph">{{ placeholder }}</span>
      <span class="arrow" :class="{ up: open }">⌄</span>
    </button>

    <Transition name="pop">
      <div v-if="open" class="dropdown">
        <button v-for="(o, i) in options" :key="o.value" type="button"
                class="option" :class="{ active: o.value === modelValue, hover: i === activeIdx }"
                @mouseenter="activeIdx = i"
                @click="pick(o)">
          <span v-if="o.emoji" class="o-emoji">{{ o.emoji }}</span>
          <span class="o-label">{{ o.label }}</span>
          <span v-if="o.value === modelValue" class="check">✓</span>
        </button>
        <button v-if="allowNew" type="button" class="option new"
                :class="{ hover: activeIdx === options.length }"
                @mouseenter="activeIdx = options.length"
                @click="pick({ value: '__new', label: '新建分类' })">
          <span class="o-emoji">➕</span>新建分类
        </button>
        <div v-if="newMode" class="new-row" @click.stop>
          <input ref="inputRef" v-model="newName" class="input" placeholder="分类名称,回车创建"
                 maxlength="16" @keydown.enter.prevent="createNew" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.qd-select { position: relative; }
.trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; width: 100%; cursor: pointer; }
.trigger:hover { cursor: pointer; }
.ph { color: var(--text-3); }
.arrow { color: var(--text-3); font-size: 13px; transition: transform var(--dur-fast) var(--ease); }
.arrow.up { transform: rotate(180deg); }
.label { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0; right: 0;
  z-index: 90;
  padding: 5px;
  border-radius: 12px;
  background: var(--bg-elevated);
  backdrop-filter: blur(28px) saturate(1.6);
  box-shadow: var(--shadow-pop), inset 0 0 0 1px var(--divider);
  display: flex; flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
}
.option {
  display: flex; align-items: center; gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text-1);
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.option.hover, .option:hover { background: var(--accent-soft); }
.option.new { color: var(--text-2); }
.o-emoji { width: 18px; text-align: center; }
.o-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check { color: var(--accent); font-size: 12px; }
.new-row { padding: 4px 6px 6px; }
</style>
