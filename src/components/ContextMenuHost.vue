<script setup>
// 全局右键菜单 / ⋯ 菜单宿主
import { onMounted, onUnmounted } from 'vue'
import { s, closeContextMenu } from '../composables/store'

function run(item) {
  closeContextMenu()
  item.action?.()
}

function onGlobalMousedown() { closeContextMenu() }
function onKey(e) { if (e.key === 'Escape') closeContextMenu() }
onMounted(() => {
  window.addEventListener('mousedown', onGlobalMousedown)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('mousedown', onGlobalMousedown)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Transition name="pop">
    <div v-if="s.ctxMenu.open"
         class="ctx-menu no-drag"
         :style="{ left: s.ctxMenu.x + 'px', top: s.ctxMenu.y + 'px' }"
         @mousedown.stop
         @contextmenu.prevent>
      <button v-for="(item, i) in s.ctxMenu.items" :key="i"
              class="ctx-item" :class="{ danger: item.danger }"
              @click="run(item)">
        <span class="ci-icon">{{ item.icon }}</span>{{ item.label }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 160;
  min-width: 176px;
  padding: 5px;
  border-radius: 12px;
  background: var(--bg-elevated);
  backdrop-filter: blur(28px) saturate(1.6);
  box-shadow: var(--shadow-pop), inset 0 0 0 1px var(--divider);
  display: flex;
  flex-direction: column;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--text-1);
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.ctx-item:hover { background: var(--accent-soft); }
.ctx-item:active { transform: scale(0.98); }
.ctx-item.danger { color: var(--danger); }
.ctx-item.danger:hover { background: var(--danger-soft); }
.ci-icon { width: 16px; text-align: center; font-size: 12px; opacity: 0.85; }
</style>
