<script setup>
// 键值对编辑器(工作空间变量 / 启动配置环境变量 通用)
// 行内编辑:键 + 值 + 删除;底部「添加」
// v-model 绑定一个对象 { key: value }
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  keyPlaceholder: { type: String, default: '变量名' },
  valuePlaceholder: { type: String, default: '值' },
  keyPattern: { type: String, default: '^[A-Za-z_][A-Za-z0-9_-]*$' }
})
const emit = defineEmits(['update:modelValue'])

// 编辑态:数组形式 [{ key, value }],保存时合并回对象
const rows = ref([])
watch(() => props.modelValue, (obj) => {
  rows.value = Object.entries(obj || {}).map(([key, value]) => ({ key, value: String(value) }))
}, { immediate: true, deep: true })

function commit() {
  const out = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (k) out[k] = r.value
  }
  emit('update:modelValue', out)
}

function addRow() {
  rows.value.push({ key: '', value: '' })
}

function removeRow(i) {
  rows.value.splice(i, 1)
  commit()
}

// 键合法性(用于提示;不阻塞输入)
function keyInvalid(k) {
  if (!k) return false
  try { return !new RegExp(props.keyPattern).test(k) } catch (_) { return false }
}
</script>

<template>
  <div class="kv-editor">
    <div v-if="rows.length === 0" class="kv-empty">暂无条目</div>
    <div v-for="(row, i) in rows" :key="i" class="kv-row">
      <input v-model="row.key" class="input kv-key" :class="{ invalid: keyInvalid(row.key) }"
             :placeholder="keyPlaceholder" spellcheck="false"
             @change="commit" />
      <span class="kv-sep">=</span>
      <input v-model="row.value" class="input kv-val"
             :placeholder="valuePlaceholder" spellcheck="false"
             @change="commit" />
      <button class="kv-del" title="删除此行" @click="removeRow(i)">✕</button>
    </div>
    <button class="kv-add" @click="addRow">＋ 添加</button>
  </div>
</template>

<style scoped>
.kv-editor { display: flex; flex-direction: column; gap: 6px; }
.kv-empty { font-size: 11.5px; color: var(--text-3); padding: 4px 2px; }
.kv-row { display: flex; align-items: center; gap: 6px; }
.kv-key { width: 38%; height: 30px; font-size: 12px; font-family: Consolas, monospace; }
.kv-sep { color: var(--text-3); font-size: 12px; flex-shrink: 0; }
.kv-val { flex: 1; height: 30px; font-size: 12px; font-family: Consolas, monospace; }
.kv-del {
  width: 24px; height: 24px;
  border-radius: 6px;
  font-size: 10px;
  color: var(--text-3);
  flex-shrink: 0;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.kv-del:hover { background: var(--danger-soft); color: var(--danger); }
.kv-del:active { transform: scale(0.9); }
.kv-add {
  align-self: flex-start;
  font-size: 11.5px;
  color: var(--accent);
  padding: 3px 8px;
  border-radius: 6px;
  transition: background var(--dur-fast) var(--ease);
}
.kv-add:hover { background: var(--accent-soft); }
</style>
