<script setup>
// ============================================================
// 命令运行弹窗(v2.1 Command Vault)
// ask 变量表单(默认值 = varMemory 记忆)+ 实时预览渲染结果
// + 危险命令强制确认(命中 settings.run.dangerPatterns 时
//   运行按钮禁用,必须勾选「我确认」)+ 复制 / 运行
// 运行 = 主进程隐藏 cmd /c,输出进日志中心(logstore)
// ============================================================
import { ref, computed, watch, nextTick } from 'vue'
import { s, toast } from '../composables/store'
import {
  resolveSources, previewRender, runCommand, copyCommand, commandById
} from '../stores/commandStore'

const cmd = computed(() => commandById(s.commandRun.cmdId))

const askValues = ref({})       // key → 用户填写值
const confirmDanger = ref(false)
const inputRefs = {}

const sources = computed(() => cmd.value ? resolveSources(cmd.value.template) : {})
const askKeys = computed(() => Object.entries(sources.value).filter(([, i]) => i.source === 'ask').map(([k]) => k))

// 预览文本(填了的替换,没填的保留 {{key}})
const preview = computed(() => cmd.value ? previewRender(cmd.value.template, askValues.value) : { text: '', missing: [] })
const missingKeys = computed(() => preview.value.missing)

/* ---- 危险命令检测:渲染后命令(含未填变量原文)匹配 dangerPatterns ---- */
const dangerHit = computed(() => {
  const pats = s.data.settings.run?.dangerPatterns || []
  if (!pats.length || !preview.value.text) return null
  for (const p of pats) {
    try { if (new RegExp(p, 'i').test(preview.value.text)) return p } catch (_) {}
  }
  return null
})
const mustConfirm = computed(() => !!dangerHit.value)

// 打开时初始化 ask 表单默认值(varMemory 记忆)
watch(() => s.commandRun.open, (open) => {
  if (!open || !cmd.value) return
  confirmDanger.value = false
  const init = {}
  const mem = cmd.value.varMemory || {}
  for (const k of askKeys.value) init[k] = mem[k] || ''
  askValues.value = init
  nextTick(() => { inputRefs[askKeys.value[0]]?.focus() })
})

function close() { s.commandRun.open = false }

async function doCopy() {
  if (!cmd.value) return
  await copyCommand(cmd.value)
  close()
}

async function doRun() {
  if (!cmd.value) return
  if (missingKeys.value.length) { toast('请先填写全部变量', 'error'); return }
  if (mustConfirm.value && !confirmDanger.value) { toast('危险命令需要先勾选确认', 'error'); return }
  const r = await runCommand(cmd.value, askValues.value, confirmDanger.value)
  if (r.ok) close()
}

// 变量来源徽标
function sourceText(k) {
  const src = sources.value[k]?.source
  return { workspace: '空间变量', global: '全局变量', ask: '运行时填写' }[src] || ''
}
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.commandRun.open && cmd" class="cr-mask" @mousedown.self="close">
      <Transition name="modal-box" appear>
        <div class="cr-box">
          <!-- 标题 -->
          <div class="cr-head">
            <span class="cr-emoji">{{ cmd.emoji || '⌨️' }}</span>
            <div class="cr-title">
              <div class="cr-name">{{ cmd.name }}</div>
              <div class="cr-sub">隐藏 cmd /c 运行 · 输出实时写入日志中心</div>
            </div>
            <button class="cr-x" @click="close">✕</button>
          </div>

          <!-- ask 变量表单 -->
          <div v-if="askKeys.length" class="cr-vars">
            <div class="cr-sec-label">
              运行时变量 <span class="cr-sec-tip">记住的值来自上次填写(varMemory)</span>
            </div>
            <label v-for="k in askKeys" :key="k" class="cr-var-row">
              <span class="cr-var-key">{{ k }}</span>
              <input v-model="askValues[k]" class="cr-var-input" spellcheck="false"
                     :ref="el => (inputRefs[k] = el)"
                     :placeholder="`{{${k}}} 的值`" @keydown.enter="doRun" />
              <span class="cr-var-src">{{ sourceText(k) }}</span>
            </label>
          </div>
          <div v-else class="cr-noask">命令没有需要运行时填写的变量,可直接复制或运行</div>

          <!-- 实时预览 -->
          <div class="cr-preview-wrap">
            <div class="cr-sec-label">渲染预览</div>
            <div class="cr-preview" :class="{ danger: dangerHit }">
              <template v-for="(seg, i) in preview.text.split(/(\{\{[^}]+\}\})/g)" :key="i">
                <span v-if="/^\{\{.+\}\}$/.test(seg)" class="pv-missing">{{ seg }}</span>
                <span v-else>{{ seg }}</span>
              </template>
            </div>
            <div v-if="missingKeys.length" class="cr-preview-tip warn">
              ⚠ {{ missingKeys.length }} 个变量未填写:{{ missingKeys.join(', ') }}
            </div>
            <div v-else-if="dangerHit" class="cr-preview-tip danger">
              ☠ 命中危险规则 <code>{{ dangerHit }}</code> — 运行前必须确认
            </div>
            <div v-else class="cr-preview-tip ok">✓ 变量已全部解析</div>
          </div>

          <!-- 危险确认 -->
          <label v-if="mustConfirm" class="cr-danger-confirm">
            <input v-model="confirmDanger" type="checkbox" />
            <span>我确认此命令的影响范围,自愿执行危险操作</span>
          </label>

          <!-- 操作 -->
          <div class="cr-foot">
            <button class="btn" @click="doCopy">📋 复制</button>
            <div class="cr-foot-right">
              <button class="btn" @click="close">取消</button>
              <button class="btn btn-primary cr-run" :class="{ danger: mustConfirm }"
                      :disabled="!!missingKeys.length || (mustConfirm && !confirmDanger)"
                      @click="doRun">
                ▶ 运行
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.cr-mask {
  position: fixed; inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px) saturate(1.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cr-box {
  width: 620px;
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

/* 标题 */
.cr-head { display: flex; align-items: center; gap: 12px; }
.cr-emoji {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  font-size: 20px;
  background: var(--bg-input);
  border-radius: 10px;
  flex-shrink: 0;
}
.cr-title { flex: 1; min-width: 0; }
.cr-name { font-size: 15px; font-weight: 600; color: var(--text-1); }
.cr-sub { font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.cr-x {
  width: 28px; height: 28px;
  border-radius: 8px;
  color: var(--text-3);
  font-size: 12px;
  flex-shrink: 0;
}
.cr-x:hover { background: var(--bg-card-hover); color: var(--text-1); }

/* 区块标签 */
.cr-sec-label { font-size: 11.5px; color: var(--text-3); letter-spacing: 0.5px; margin-bottom: 8px; }
.cr-sec-tip { opacity: 0.75; }

/* 变量表单 */
.cr-vars {
  background: var(--bg-card);
  border: 1px solid var(--divider);
  border-radius: var(--radius-btn);
  padding: 12px;
}
.cr-var-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.cr-var-key {
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;
  min-width: 72px;
  text-align: center;
}
.cr-var-input {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 12.5px;
}
.cr-var-input:focus { border-color: var(--accent); outline: none; }
.cr-var-src { font-size: 10.5px; color: var(--text-3); flex-shrink: 0; width: 72px; text-align: right; }
.cr-noask { font-size: 12px; color: var(--text-3); padding: 4px 0; }

/* 预览 */
.cr-preview-wrap {
  background: var(--bg-card);
  border: 1px solid var(--divider);
  border-radius: var(--radius-btn);
  padding: 12px;
}
.cr-preview {
  font-family: Consolas, "Courier New", monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-1);
  background: var(--bg-input);
  border-radius: 8px;
  padding: 10px 12px;
  word-break: break-all;
  white-space: pre-wrap;
  user-select: text;
}
.cr-preview.danger { box-shadow: inset 0 0 0 1px rgba(255, 93, 93, 0.55); }
.pv-missing { color: var(--warning); background: rgba(254, 188, 46, 0.12); border-radius: 3px; }
.cr-preview-tip { font-size: 11.5px; margin-top: 8px; }
.cr-preview-tip.warn { color: var(--warning); }
.cr-preview-tip.danger { color: var(--danger); }
.cr-preview-tip.ok { color: var(--success); }
.cr-preview-tip code {
  font-family: Consolas, monospace;
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 4px;
}

/* 危险确认 */
.cr-danger-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--danger);
  padding: 10px 12px;
  border-radius: var(--radius-btn);
  background: rgba(255, 93, 93, 0.08);
  border: 1px dashed rgba(255, 93, 93, 0.45);
  cursor: pointer;
  user-select: none;
}
.cr-danger-confirm input { accent-color: var(--danger); }

/* 底栏 */
.cr-foot { display: flex; align-items: center; justify-content: space-between; }
.cr-foot-right { display: flex; gap: 8px; }
.cr-run.danger:not(:disabled) {
  background: linear-gradient(135deg, #FF5D5D, #FF8A3D);
  box-shadow: 0 2px 12px rgba(255, 93, 93, 0.4);
}
.cr-run:disabled { opacity: 0.45; cursor: not-allowed; }

/* 过渡 */
.modal-mask-enter-active, .modal-mask-leave-active { transition: opacity 0.18s ease; }
.modal-mask-enter-from, .modal-mask-leave-to { opacity: 0; }
.modal-box-enter-active { transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
.modal-box-leave-active { transition: all 0.15s ease; }
.modal-box-enter-from { transform: scale(0.95) translateY(10px); opacity: 0; }
.modal-box-leave-to { transform: scale(0.97); opacity: 0; }
</style>
