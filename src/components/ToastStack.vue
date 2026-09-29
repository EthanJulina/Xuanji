<script setup>
// Toast 通知:顶部滑入滑出,禁止使用 alert
import { s } from '../composables/store'
</script>

<template>
  <div class="toast-stack">
    <TransitionGroup name="toast">
      <div v-for="t in s.toasts" :key="t.id" class="toast" :class="t.type">
        <span class="ico">{{ t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ' }}</span>
        <span class="msg">{{ t.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: calc(var(--titlebar-h) + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 460px;
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--bg-elevated);
  backdrop-filter: blur(20px) saturate(1.5);
  box-shadow: var(--shadow-pop), inset 0 0 0 1px var(--divider);
  font-size: 13px;
  color: var(--text-1);
}
.ico {
  width: 18px; height: 18px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 10.5px;
  flex-shrink: 0;
  color: #fff;
}
.toast.success .ico { background: var(--success); }
.toast.error .ico { background: var(--danger); }
.toast.info .ico { background: var(--accent); }
.msg { line-height: 1.4; word-break: break-all; }
</style>
