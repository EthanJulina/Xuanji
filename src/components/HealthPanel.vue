<script setup>
// ============================================================
// 健康检查拦截面板(v2.1)
// 启动链路:工具挂了 checkIds 且有红项(blockOnFail)时弹出
// 展示逐项结果 + fixTip 修复建议;支持「重新检查」与
// 「跳过检查强制启动」(skipHealth → launcher:run)
// ============================================================
import { ref, computed } from 'vue'
import { s, toolById, toast } from '../composables/store'

const qd = window.qd
const results = computed(() => s.healthPanel.results || [])
const tool = computed(() => toolById(s.healthPanel.toolId))
const failedCount = computed(() => results.value.filter(r => !r.ok).length)
const running = ref(false)

async function rerun() {
  running.value = true
  const ids = results.value.map(r => r.checkId)
  s.healthPanel.results = await qd.healthRun({ checkIds: ids, force: true })
  running.value = false
  if (results.value.every(r => r.ok)) toast('全部检查通过,可以启动了', 'success')
}

// 跳过检查强制启动
async function forceStart() {
  const t = toolById(s.healthPanel.toolId)
  if (!t) { s.healthPanel.open = false; return }
  const plain = JSON.parse(JSON.stringify(t))
  const r = await qd.launcherRun({ tool: plain, configId: s.healthPanel.configId, skipHealth: true })
  if (r.ok) {
    const nowIso = new Date().toISOString().slice(0, 19)
    t.runCount = (t.runCount || 0) + 1
    t.lastRunAt = nowIso
    t.startHistory = [nowIso, ...(t.startHistory || [])].slice(0, 30)
    const { persist } = await import('../composables/store')
    persist()
    toast(`已跳过检查启动「${t.name}」`, 'success')
  } else {
    toast(r.message || '启动失败', 'error')
  }
  s.healthPanel.open = false
}

function close() { s.healthPanel.open = false }

function typeName(t) {
  return { exec: '命令', port: '端口', file: '文件' }[t] || t
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.healthPanel.open" class="hp-mask" @mousedown.self="close">
      <Transition name="modal-box" appear>
        <div class="hp-box">
          <!-- 标题 -->
          <div class="hp-head">
            <span class="hp-ico">🩺</span>
            <div class="hp-title">
              <div class="hp-name">环境检查未通过 — {{ tool?.name || '工具' }}</div>
              <div class="hp-sub">{{ failedCount }}/{{ results.length }} 项异常;修复后可重新检查,或跳过检查强制启动</div>
            </div>
            <button class="hp-x" @click="close">✕</button>
          </div>

          <!-- 检查项列表 -->
          <div class="hp-list">
            <div v-for="r in results" :key="r.checkId" class="hp-item" :class="{ bad: !r.ok }">
              <span class="hp-dot" :class="r.ok ? 'ok' : 'bad'">{{ r.ok ? '✓' : '✕' }}</span>
              <div class="hp-item-main">
                <div class="hp-item-name">
                  {{ r.name }}
                  <span class="hp-type">{{ typeName(r.type) }}</span>
                  <span v-if="r.cached" class="hp-cached">缓存</span>
                  <span v-if="r.durationMs" class="hp-ms">{{ r.durationMs }}ms</span>
                </div>
                <div class="hp-item-msg">{{ r.message }}</div>
                <div v-if="!r.ok && r.fixTip" class="hp-fix">💡 {{ r.fixTip }}</div>
              </div>
            </div>
          </div>

          <!-- 操作 -->
          <div class="hp-foot">
            <button class="btn" :disabled="running" @click="rerun">{{ running ? '检查中…' : '↻ 重新检查' }}</button>
            <div class="hp-foot-right">
              <button class="btn" @click="close">取消</button>
              <button class="btn hp-force" @click="forceStart">跳过检查,强制启动</button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.hp-mask {
  position: fixed; inset: 0;
  z-index: 152;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px) saturate(1.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hp-box {
  width: 520px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  border-radius: 16px;
  background: var(--bg-elevated);
  backdrop-filter: blur(36px) saturate(1.7);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hp-head { display: flex; align-items: center; gap: 12px; }
.hp-ico { font-size: 22px; flex-shrink: 0; }
.hp-title { flex: 1; min-width: 0; }
.hp-name { font-size: 14.5px; font-weight: 600; color: var(--text-1); }
.hp-sub { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.hp-x {
  width: 28px; height: 28px;
  border-radius: 8px;
  color: var(--text-3);
  font-size: 12px;
  flex-shrink: 0;
}
.hp-x:hover { background: var(--bg-card-hover); color: var(--text-1); }

.hp-list { display: flex; flex-direction: column; gap: 8px; }
.hp-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
}
.hp-item.bad { border-color: rgba(255, 93, 93, 0.4); background: rgba(255, 93, 93, 0.05); }
.hp-dot {
  width: 20px; height: 20px;
  display: grid; place-items: center;
  font-size: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 1px;
}
.hp-dot.ok { color: var(--success); background: rgba(53, 199, 89, 0.14); }
.hp-dot.bad { color: var(--danger); background: rgba(255, 93, 93, 0.16); }
.hp-item-main { flex: 1; min-width: 0; }
.hp-item-name { font-size: 12.5px; font-weight: 500; color: var(--text-1); display: flex; align-items: center; gap: 6px; }
.hp-type {
  font-size: 9.5px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 7px;
}
.hp-cached {
  font-size: 9px;
  color: var(--text-3);
  border: 1px solid var(--divider-strong);
  padding: 0 5px;
  border-radius: 6px;
}
.hp-ms { font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.hp-item-msg { font-size: 11.5px; color: var(--text-2); margin-top: 3px; }
.hp-fix {
  font-size: 11.5px;
  color: var(--warning);
  margin-top: 5px;
  padding: 6px 9px;
  border-radius: 7px;
  background: rgba(254, 188, 46, 0.08);
}

.hp-foot { display: flex; align-items: center; justify-content: space-between; }
.hp-foot-right { display: flex; gap: 8px; }
.hp-force {
  background: linear-gradient(135deg, #FF8A3D, #FFB13D);
  box-shadow: 0 2px 10px rgba(255, 138, 61, 0.35);
}

.modal-mask-enter-active, .modal-mask-leave-active { transition: opacity 0.18s ease; }
.modal-mask-enter-from, .modal-mask-leave-to { opacity: 0; }
.modal-box-enter-active { transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
.modal-box-leave-active { transition: all 0.15s ease; }
.modal-box-enter-from { transform: scale(0.95) translateY(10px); opacity: 0; }
.modal-box-leave-to { transform: scale(0.97); opacity: 0; }
</style>
