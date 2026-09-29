<script setup>
// 日志面板:右侧滑出抽屉,展示 bat/exe 的输出
// 等级彩色徽标(INFO/WARN/ERROR/SUCCESS)+ 复制/保存/清空/结束进程/关闭
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { s, toolById, isRunning, killByTool, toast } from '../composables/store'

const qd = window.qd
const logs = ref([])
const listEl = ref(null)
const tool = computed(() => s.logPanel.toolId ? toolById(s.logPanel.toolId) : null)
const running = computed(() => tool.value && isRunning(tool.value.id))

// 拉取日志 + 实时追加(主进程 runner:log 事件)
async function reload() {
  if (!s.logPanel.toolId) return
  logs.value = await qd.toolLogs(s.logPanel.toolId)
  scrollBottom()
}
watch(() => [s.logPanel.open, s.logPanel.toolId], ([open]) => { if (open) reload() })

let offLog = null
onMounted(() => { offLog = qd.onRunnerLog(() => { if (s.logPanel.open) reload() }) })
onUnmounted(() => { offLog?.() })

function scrollBottom() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })
}

async function kill() {
  if (!s.logPanel.toolId) return
  await killByTool(s.logPanel.toolId)
  toast('已结束进程', 'success')
}

// 复制全部日志到剪贴板
async function copyAll() {
  if (!logs.value.length) { toast('暂无日志可复制', 'info'); return }
  const text = logs.value.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.text}`).join('\n')
  await qd.copyText(text)
  toast(`已复制 ${logs.value.length} 行日志`, 'success')
}

// 另存为 txt 文件
async function saveAs() {
  if (!logs.value.length) { toast('暂无日志可保存', 'info'); return }
  const lines = logs.value.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.text}`)
  const r = await qd.saveLogsAs(tool.value?.name || '工具', lines)
  if (r.ok) toast('日志已保存', 'success')
}

// 清空当前工具的日志(主进程 + 本地同步)
async function clearLogs() {
  if (!s.logPanel.toolId) return
  await qd.clearLogs(s.logPanel.toolId)
  logs.value = []
  toast('日志已清空', 'success')
}

// 等级徽标文字(v2.1:新增 warning 级 —— 日志中心模式判定产生)
function lvlText(level) {
  return { info: 'INFO', success: 'SUCCESS', warn: 'WARN', warning: 'WARN', error: 'ERROR' }[level] || 'INFO'
}
</script>

<template>
  <Transition name="fade">
    <div v-if="s.logPanel.open" class="log-wrap">
      <Transition name="drawer" appear>
        <div class="panel">
          <div class="head">
            <div class="head-info">
              <span class="t-name">{{ tool?.name || '日志' }}</span>
              <span class="t-state" :class="{ run: running }">
                {{ running ? '● 运行中' : '○ 未运行' }}
              </span>
            </div>
            <div class="head-btns">
              <button v-if="running" class="btn btn-danger sm" @click="kill">结束进程</button>
              <button class="btn btn-ghost sm" title="复制全部日志" @click="copyAll">复制</button>
              <button class="btn btn-ghost sm" title="另存为 txt" @click="saveAs">保存</button>
              <button class="btn btn-ghost sm" @click="clearLogs">清空</button>
              <button class="btn btn-ghost sm" @click="s.logPanel.open = false">关闭</button>
            </div>
          </div>
          <div ref="listEl" class="log-list scroll-area">
            <div v-if="logs.length === 0" class="log-empty">
              暂无日志。<br />「隐藏窗口 / 日志模式」运行的 bat/cmd 与 exe 的输出会记录在这里。
            </div>
            <div v-for="(l, i) in logs" :key="i" class="log-line" :class="l.level">
              <span class="log-time">{{ l.time }}</span>
              <span class="lvl" :class="l.level">{{ lvlText(l.level) }}</span>
              <span class="log-text">{{ l.text }}</span>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.log-wrap { position: fixed; inset: 0; z-index: 105; pointer-events: none; }
.panel {
  position: absolute;
  top: calc(var(--titlebar-h) + 8px);
  right: 12px;
  bottom: 12px;
  width: 460px;
  max-width: calc(100vw - 60px);
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(32px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--divider);
}
.head-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
.t-name { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-state { font-size: 11px; color: var(--text-3); flex-shrink: 0; }
.t-state.run { color: var(--success); }
.head-btns { display: flex; gap: 6px; flex-shrink: 0; }
.sm { height: 26px; padding: 0 10px; font-size: 12px; }

.log-list { flex: 1; overflow-y: auto; padding: 10px 14px; font-family: Consolas, "Courier New", monospace; }
.log-empty { font-size: 12px; color: var(--text-3); text-align: center; padding: 40px 0; line-height: 2; }
.log-line { display: flex; gap: 8px; padding: 3px 0; font-size: 11.5px; line-height: 1.6; align-items: baseline; }
.log-time { color: var(--text-3); flex-shrink: 0; font-size: 10.5px; }

/* 等级徽标 */
.lvl {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.5;
  align-self: center;
}
.lvl.info { color: #8FA8CC; background: rgba(143, 168, 204, 0.12); }
.lvl.success { color: var(--success); background: rgba(53, 199, 89, 0.12); }
.lvl.warn, .lvl.warning { color: #E8A33D; background: rgba(232, 163, 61, 0.14); }
.lvl.error { color: var(--danger); background: rgba(255, 93, 93, 0.12); }

.log-text { color: var(--text-2); word-break: break-all; user-select: text; white-space: pre-wrap; }
.log-line.error .log-text { color: var(--danger); }
.log-line.success .log-text { color: var(--success); }
.log-line.warn .log-text, .log-line.warning .log-text { color: #E8A33D; }
</style>
