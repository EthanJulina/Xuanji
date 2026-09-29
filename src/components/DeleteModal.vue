<script setup>
// 删除工具确认弹窗:仅删除条目,不删除原文件
import { s, removeTool, toast } from '../composables/store'

async function confirmDelete() {
  const tool = s.deleteModal.tool
  if (!tool) return
  await removeTool(tool.id)
  s.deleteModal = { open: false, tool: null }
  toast(`已删除「${tool.name}」(原文件不受影响)`, 'success')
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.deleteModal.open" class="mask" @mousedown.self="s.deleteModal = { open: false, tool: null }">
      <Transition name="modal-box" appear>
        <div class="box">
          <div class="warn-ico">🗑</div>
          <h3 class="title">删除工具</h3>
          <p class="message">
            确定删除「<b>{{ s.deleteModal.tool?.name }}</b>」吗?
          </p>
          <p class="note">仅删除条目,不会删除原文件 / 快捷方式。</p>
          <div class="actions">
            <button class="btn" @click="s.deleteModal = { open: false, tool: null }">取消</button>
            <button class="btn btn-danger" @click="confirmDelete">删除</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 118;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.2);
  display: grid; place-items: center;
}
.box {
  width: 360px;
  padding: 24px;
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  text-align: center;
}
.warn-ico {
  width: 48px; height: 48px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: var(--danger-soft);
  display: grid; place-items: center;
  font-size: 20px;
}
.title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.message { font-size: 13px; color: var(--text-2); line-height: 1.6; }
.message b { color: var(--text-1); }
.note {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--text-3);
  background: var(--bg-input);
  border-radius: var(--radius-btn);
  padding: 7px 10px;
}
.actions { display: flex; justify-content: center; gap: 10px; margin-top: 18px; }
</style>
