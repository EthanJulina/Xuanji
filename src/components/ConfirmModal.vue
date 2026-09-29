<script setup>
// 通用确认弹窗(Promise 化):替代原生 confirm
import { onMounted, onUnmounted } from 'vue'
import { s } from '../composables/store'

function close(result) {
  s.confirmState.resolve?.(result)
  s.confirmState = { open: false, options: null, resolve: null }
}

function onKey(e) {
  if (!s.confirmState.open) return
  if (e.key === 'Escape') close(false)
  if (e.key === 'Enter') close(true)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.confirmState.open" class="mask" @mousedown.self="close(false)">
      <Transition name="modal-box" appear>
        <div class="box">
          <h3 class="title">{{ s.confirmState.options?.title || '确认操作' }}</h3>
          <p class="message">{{ s.confirmState.options?.message }}</p>
          <p v-if="s.confirmState.options?.detail" class="detail">{{ s.confirmState.options.detail }}</p>
          <div class="actions">
            <button class="btn" @click="close(false)">取消</button>
            <button class="btn" :class="s.confirmState.options?.danger === false ? 'btn-primary' : 'btn-danger'"
                    @click="close(true)">
              {{ s.confirmState.options?.confirmText || '确认' }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.2);
  display: grid; place-items: center;
}
.box {
  width: 380px;
  padding: 22px 24px 18px;
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
}
.title { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
.message { font-size: 13px; color: var(--text-2); line-height: 1.6; word-break: break-all; }
.detail {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
  background: var(--bg-input);
  border-radius: var(--radius-btn);
  padding: 8px 10px;
  word-break: break-all;
  line-height: 1.5;
}
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
