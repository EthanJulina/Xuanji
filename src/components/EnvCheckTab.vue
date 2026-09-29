<script setup>
// ============================================================
// 工具编辑弹窗 -「环境检查」标签页(v2.1)
// 勾选该工具启动前需要执行的健康检查模板;可就地新建模板
// 挂载关系存 tool.checkIds;立即试跑不走缓存
// ============================================================
import { ref, computed, onMounted } from 'vue'
import { s, toast, persist } from '../composables/store'
import { healthChecks, reloadChecks, createCheck, toggleToolCheck } from '../stores/healthStore'

const props = defineProps({
  tool: { type: Object, required: true }
})

const qd = window.qd
const testing = ref('')
const testResults = ref({})     // checkId → { ok, message }

const mountedIds = computed(() => new Set(props.tool.checkIds || []))

function isMounted(id) { return mountedIds.value.has(id) }

async function toggle(id) {
  await toggleToolCheck(props.tool.id, id)
}

// 就地新建模板(简化版:名称 + 类型 + 主要参数)
const quick = ref({ open: false, name: '', type: 'exec', command: '', expectRegex: '', port: 0, path: '', fixTip: '' })
async function quickCreate() {
  const f = quick.value
  if (!f.name.trim()) { toast('名称不能为空', 'error'); return }
  if (f.type === 'exec' && !f.command.trim()) { toast('请填写检测命令', 'error'); return }
  if (f.type === 'port' && (!f.port || f.port < 1)) { toast('请填写有效端口', 'error'); return }
  if (f.type === 'file' && !f.path.trim()) { toast('请填写检测路径', 'error'); return }
  const chk = await createCheck(f)
  quick.value = { open: false, name: '', type: 'exec', command: '', expectRegex: '', port: 0, path: '', fixTip: '' }
  // 创建后自动挂载到当前工具
  if (!Array.isArray(props.tool.checkIds)) props.tool.checkIds = []
  props.tool.checkIds.push(chk.id)
  persist()
  toast(`已创建并挂载「${chk.name}」`, 'success')
}

// 立即试跑(不走缓存)
async function testAll() {
  const ids = props.tool.checkIds || []
  if (!ids.length) return
  testing.value = 'all'
  const r = await qd.healthRun({ checkIds: ids, force: true })
  const map = {}
  for (const item of r || []) map[item.checkId] = item
  testResults.value = map
  testing.value = ''
  const bad = (r || []).filter(x => !x.ok).length
  if (bad) toast(`${bad} 项检查未通过,启动时将拦截`, 'error', 4000)
  else toast('全部检查通过 ✓', 'success')
}

function typeText(t) {
  return { exec: '命令', port: '端口', file: '文件' }[t] || t
}

onMounted(reloadChecks)
</script>

<template>
  <div class="ec-tab">
    <p class="ec-hint">
      勾选启动前需要执行的环境检查;有红项时启动会被拦截(可在拦截面板强制跳过)。
      模板管理在「设置 → 环境健康检查」。
    </p>

    <div v-if="healthChecks.list.length" class="ec-list">
      <label v-for="c in healthChecks.list" :key="c.id" class="ec-row" :class="{ mounted: isMounted(c.id) }">
        <input type="checkbox" :checked="isMounted(c.id)" @change="toggle(c.id)" />
        <div class="ec-main">
          <div class="ec-name">
            {{ c.name }}
            <span class="ec-type">{{ typeText(c.type) }}</span>
            <span v-if="testResults[c.id]" class="ec-result" :class="testResults[c.id].ok ? 'ok' : 'bad'">
              {{ testResults[c.id].ok ? '✓' : '✕' }} {{ testResults[c.id].message }}
            </span>
          </div>
          <div class="ec-detail mono">
            {{ c.type === 'exec' ? c.command : c.type === 'port' ? `${c.host}:${c.port}` : c.path }}
            <template v-if="c.type === 'exec' && c.expectRegex"> · 期望 /{{ c.expectRegex }}/i</template>
          </div>
        </div>
      </label>
    </div>
    <p v-else class="ec-empty">还没有检查模板(内置预设已随迁移写入,如果没有请到设置页新建)</p>

    <div class="ec-btns">
      <button class="btn btn-sm" :disabled="!mountedIds.size || testing === 'all'" @click="testAll">
        {{ testing === 'all' ? '检测中…' : '▶ 立即试跑' }}
      </button>
      <button class="btn btn-sm" @click="quick.open = true">＋ 新建模板</button>
    </div>

    <!-- 就地新建模板 -->
    <Transition name="fade">
      <div v-if="quick.open" class="ec-quick">
        <div class="f-row2">
          <input v-model="quick.name" class="f-input" placeholder="检查名称 *" spellcheck="false" />
          <select v-model="quick.type" class="f-input f-select">
            <option value="exec">命令检测</option>
            <option value="port">端口检测</option>
            <option value="file">文件检测</option>
          </select>
        </div>
        <template v-if="quick.type === 'exec'">
          <input v-model="quick.command" class="f-input mono" placeholder="检测命令,如:java -version" spellcheck="false" />
          <input v-model="quick.expectRegex" class="f-input mono" placeholder="期望输出正则(可空)" spellcheck="false" />
        </template>
        <input v-if="quick.type === 'port'" v-model.number="quick.port" type="number" min="1" max="65535" class="f-input" placeholder="端口 *" />
        <input v-if="quick.type === 'file'" v-model="quick.path" class="f-input mono" placeholder="检测路径 *" spellcheck="false" />
        <input v-model="quick.fixTip" class="f-input" placeholder="修复建议(可空)" spellcheck="false" />
        <div class="ec-quick-btns">
          <button class="btn btn-sm" @click="quick.open = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="quickCreate">创建并挂载</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ec-tab { display: flex; flex-direction: column; gap: 10px; }
.ec-hint { font-size: 11.5px; color: var(--text-3); line-height: 1.6; }
.ec-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
.ec-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease);
}
.ec-row:hover { border-color: var(--divider-strong); }
.ec-row.mounted { border-color: var(--accent); background: var(--accent-soft); }
.ec-row input { margin-top: 3px; accent-color: var(--accent); }
.ec-main { flex: 1; min-width: 0; }
.ec-name { font-size: 12.5px; color: var(--text-1); font-weight: 500; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ec-type {
  font-size: 9.5px;
  color: var(--text-3);
  background: var(--bg-card);
  padding: 1px 6px;
  border-radius: 7px;
}
.ec-result { font-size: 10.5px; font-weight: 400; }
.ec-result.ok { color: var(--success); }
.ec-result.bad { color: var(--danger); }
.ec-detail {
  font-size: 10.5px;
  color: var(--text-3);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono { font-family: Consolas, monospace; }
.ec-empty { font-size: 12px; color: var(--text-3); padding: 10px 0; }
.ec-btns { display: flex; gap: 8px; }
.btn-sm { height: 26px; padding: 0 12px; font-size: 11.5px; }

.ec-quick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px dashed var(--divider-strong);
}
.f-row2 { display: flex; gap: 8px; }
.f-input {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 12px;
  min-width: 0;
}
.f-input:focus { border-color: var(--accent); outline: none; }
.f-select { appearance: auto; flex: 0 0 110px; }
.ec-quick-btns { display: flex; justify-content: flex-end; gap: 8px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
