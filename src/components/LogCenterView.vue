<script setup>
// ============================================================
// 日志中心(v2.1):jsonl 落盘日志的集中查看
// 布局:左栏工具列表(行数/错误/警告徽标)+ 右侧日志流
// 能力:四维过滤(等级 / 工具 / 关键字 / 时间范围)+ 虚拟滚动(1 万行)
//       + 搜索高亮 + 复制 / 导出(敏感提示)/ 清空 / 打开日志目录
// 实时:runner:log 事件增量追加(等级为主进程判定后的最终值)
// ============================================================
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { s, toolById, toast, confirmBox } from '../composables/store'

const qd = window.qd

const tools = ref([])          // [{ toolId, lines, bytes, errors, warns, lastAt }]
const curId = ref(null)
const allRows = ref([])        // 当前工具原始日志行 [{ t, lvl, text }]
const level = ref('all')       // all | info | success | warning | error
const q = ref('')              // 关键字
const range = ref('all')       // all | today | 7d
const listEl = ref(null)
const viewEl = ref(null)

/* ---------------- 工具列表 ---------------- */
async function reloadTools() {
  tools.value = await qd.logList()
}

const toolName = (id) => toolById(id)?.name || id

/* ---------------- 选中工具 → 读日志 ---------------- */
async function selectTool(id) {
  curId.value = id
  await reloadRows()
}

async function reloadRows() {
  if (!curId.value) { allRows.value = []; return }
  allRows.value = await qd.logRead(curId.value, 10000)
  scrollTop()
}

function scrollTop() {
  nextTick(() => { if (listEl.value) listEl.value.scrollTop = 0 })
}

/* ---------------- 四维过滤 ---------------- */
const LEVELS = [
  { value: 'all', label: '全部' },
  { value: 'info', label: 'INFO' },
  { value: 'success', label: 'SUCCESS' },
  { value: 'warning', label: 'WARN' },
  { value: 'error', label: 'ERROR' }
]
const RANGES = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' }
]

// 视图切换时(s.view.id 携带 toolId)自动选中 —— ToolCard「查看日志」跳转入口
watch(() => s.view.id, (id) => { if (s.view.type === 'logcenter' && id && id !== curId.value) selectTool(id) })

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  let minT = 0
  if (range.value === 'today') { const d = new Date(); minT = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
  else if (range.value === '7d') minT = Date.now() - 7 * 24 * 3600 * 1000
  return allRows.value.filter(r => {
    if (level.value !== 'all' && r.lvl !== level.value) return false
    if (minT && (!r.t || Date.parse(r.t) < minT)) return false
    if (kw && !r.text.toLowerCase().includes(kw)) return false
    return true
  })
})

const levelCounts = computed(() => {
  const c = { info: 0, success: 0, warning: 0, error: 0 }
  for (const r of allRows.value) if (c[r.lvl] !== undefined) c[r.lvl]++
  return c
})

/* ---------------- 虚拟滚动(行高固定 22px) ---------------- */
const ROW_H = 22
const OVERSCAN = 12
const scrollTopV = ref(0)
const viewH = ref(400)
let ro = null

const totalH = computed(() => filtered.value.length * ROW_H)
const startIdx = computed(() => Math.max(0, Math.floor(scrollTopV.value / ROW_H) - OVERSCAN))
const endIdx = computed(() => Math.min(filtered.value.length, Math.ceil((scrollTopV.value + viewH.value) / ROW_H) + OVERSCAN))
const visRows = computed(() => filtered.value.slice(startIdx.value, endIdx.value))
const padTop = computed(() => startIdx.value * ROW_H)

function onScroll() {
  if (listEl.value) scrollTopV.value = listEl.value.scrollTop
}

function measure() {
  if (viewEl.value) viewH.value = viewEl.value.clientHeight
}

/* ---------------- 展示辅助 ---------------- */
function fmtT(t) {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d)) return t
  const p = (n) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return sameDay ? hm : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
}

function lvlText(l) {
  return { info: 'INFO', success: 'SUCCESS', warning: 'WARN', error: 'ERROR' }[l] || 'INFO'
}

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

function fmtAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前'
  return Math.floor(diff / 86400_000) + ' 天前'
}

// 搜索高亮(先转义再包 <mark>,防注入)
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function hl(text) {
  const kw = q.value.trim()
  const safe = esc(text)
  if (!kw) return safe
  try {
    return safe.replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`)
  } catch (_) { return safe }
}

/* ---------------- 操作 ---------------- */
async function copyFiltered() {
  if (!filtered.value.length) { toast('没有可复制的日志', 'info'); return }
  const text = filtered.value.map(r => `[${fmtT(r.t)}] [${lvlText(r.lvl)}] ${r.text}`).join('\n')
  await qd.copyText(text)
  toast(`已复制 ${filtered.value.length} 行(过滤后)`, 'success')
}

// 导出:全部行(非过滤后);导出前敏感信息提示
async function exportLogs() {
  if (!curId.value || !allRows.value.length) { toast('暂无日志可导出', 'info'); return }
  const yes = await confirmBox({
    title: '导出日志',
    message: `导出「${toolName(curId.value)}」的全部日志(${allRows.value.length} 行)?`,
    detail: '⚠️ 日志内容可能包含密钥、令牌、内网路径等敏感信息,导出后请妥善保管,不要提交到公开渠道。',
    confirmText: '导出'
  })
  if (!yes) return
  const lines = await qd.logExport(curId.value)
  const r = await qd.saveLogsAs(toolName(curId.value), lines)
  if (r.ok) toast('日志已导出', 'success')
}

async function clearCur() {
  if (!curId.value) return
  const yes = await confirmBox({
    title: '清空日志',
    message: `清空「${toolName(curId.value)}」的全部落盘日志?`,
    detail: 'jsonl 文件将删除,不可恢复。',
    confirmText: '清空'
  })
  if (!yes) return
  await qd.logClear(curId.value)
  await reloadTools()
  await reloadRows()
  toast('日志已清空', 'success')
}

/* ---------------- 实时追加 ---------------- */
let offLog = null
function onRunnerLog({ toolId, entry }) {
  if (s.view.type !== 'logcenter' || toolId !== curId.value || !entry) return
  allRows.value.push({ t: new Date().toISOString(), lvl: entry.level || 'info', text: entry.text })
  // 自动吸底:用户本来就在底部附近才跟随,避免打断翻阅
  nextTick(() => {
    const el = listEl.value
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 6) el.scrollTop = el.scrollHeight
  })
}

/* ---------------- 生命周期 ---------------- */
onMounted(async () => {
  await reloadTools()
  // 视图恢复 / ToolCard 跳转:s.view.id 指定工具
  if (s.view.type === 'logcenter' && s.view.id) await selectTool(s.view.id)
  measure()
  window.addEventListener('resize', measure)
  offLog = qd.onRunnerLog(onRunnerLog)
})
onUnmounted(() => {
  window.removeEventListener('resize', measure)
  offLog?.()
})
</script>

<template>
  <div class="lc-view">
    <!-- 顶栏 -->
    <div class="lc-head">
      <div class="lc-title">
        <span class="lc-ico">📋</span>
        <h2>日志中心</h2>
        <span class="lc-sub">{{ tools.length }} 个工具留有落盘日志 · 单文件超限自动轮转 · 超期自动清理</span>
      </div>
      <div class="lc-actions">
        <button class="btn btn-ghost sm" title="打开 jsonl 日志目录" @click="qd.logOpenDir()">📁 打开目录</button>
        <button class="btn btn-ghost sm" title="刷新工具列表" @click="reloadTools">↻ 刷新</button>
      </div>
    </div>

    <div class="lc-body">
      <!-- 左栏:工具列表 -->
      <div class="lc-side scroll-area">
        <button v-for="t in tools" :key="t.toolId"
                class="lc-tool" :class="{ on: curId === t.toolId }"
                @click="selectTool(t.toolId)">
          <div class="lc-tool-top">
            <span class="lc-tool-name">{{ toolName(t.toolId) }}</span>
            <span class="lc-tool-ago">{{ fmtAgo(t.lastAt) }}</span>
          </div>
          <div class="lc-tool-meta">
            <span class="m-lines">{{ t.lines }} 行</span>
            <span v-if="t.errors" class="m-badge err">E {{ t.errors }}</span>
            <span v-if="t.warns" class="m-badge warn">W {{ t.warns }}</span>
            <span class="m-size">{{ fmtBytes(t.bytes) }}</span>
          </div>
        </button>
        <div v-if="!tools.length" class="lc-empty-side">
          还没有落盘日志。<br />「隐藏窗口 / 日志模式」运行工具后,<br />输出会以 jsonl 落盘并出现在这里。
        </div>
      </div>

      <!-- 右侧:过滤条 + 日志流 -->
      <div class="lc-main">
        <template v-if="curId">
          <!-- 四维过滤条:工具(左栏选定) + 等级 + 时间范围 + 关键字 -->
          <div class="lc-filter">
            <div class="seg">
              <button v-for="lv in LEVELS" :key="lv.value"
                      class="seg-item" :class="{ on: level === lv.value }"
                      @click="level = lv.value; scrollTop()">
                {{ lv.label }}
                <span v-if="lv.value !== 'all' && levelCounts[lv.value]" class="seg-count">{{ levelCounts[lv.value] }}</span>
              </button>
            </div>
            <select v-model="range" class="lc-range" @change="scrollTop()">
              <option v-for="r in RANGES" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
            <div class="lc-search">
              <span class="s-ico">🔍</span>
              <input v-model="q" placeholder="关键字过滤(高亮显示)" spellcheck="false" />
              <button v-if="q" class="s-clear" @click="q = ''">✕</button>
            </div>
          </div>

          <!-- 日志流(虚拟滚动) -->
          <div ref="viewEl" class="lc-stream-outer">
            <div ref="listEl" class="lc-stream scroll-area" @scroll="onScroll">
              <div class="lc-virtual" :style="{ height: totalH + 'px' }">
                <div class="lc-rows" :style="{ transform: `translateY(${padTop}px)` }">
                  <div v-for="(r, i) in visRows" :key="startIdx + i"
                       class="lc-line" :class="r.lvl" :style="{ height: ROW_H + 'px' }">
                    <span class="l-time">{{ fmtT(r.t) }}</span>
                    <span class="l-lvl" :class="r.lvl">{{ lvlText(r.lvl) }}</span>
                    <span class="l-text" v-html="hl(r.text)"></span>
                  </div>
                </div>
              </div>
              <div v-if="!filtered.length" class="lc-empty">
                {{ allRows.length ? '当前过滤条件没有命中任何行' : '该工具还没有日志' }}
              </div>
            </div>
          </div>

          <!-- 底栏:命中统计 + 操作 -->
          <div class="lc-foot">
            <span class="lc-stat">
              命中 <b>{{ filtered.length }}</b> / {{ allRows.length }} 行
              <template v-if="q.trim()"> · 关键字「{{ q.trim() }}」</template>
            </span>
            <div class="lc-foot-btns">
              <button class="btn btn-ghost sm" @click="copyFiltered">复制命中</button>
              <button class="btn btn-ghost sm" @click="exportLogs">导出</button>
              <button class="btn btn-danger sm" @click="clearCur">清空</button>
            </div>
          </div>
        </template>

        <!-- 未选择工具 -->
        <div v-else class="lc-noselect">
          <div class="ns-ico">📄</div>
          <p>从左侧选择一个工具查看落盘日志</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lc-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ---- 顶栏 ---- */
.lc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}
.lc-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.lc-ico { font-size: 18px; }
.lc-title h2 { font-size: 17px; font-weight: 600; color: var(--text-1); white-space: nowrap; }
.lc-sub { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-actions { display: flex; gap: 6px; flex-shrink: 0; }
.sm { height: 26px; padding: 0 10px; font-size: 12px; }

/* ---- 主体 ---- */
.lc-body { flex: 1; display: flex; min-height: 0; padding: 0 20px 16px; gap: 12px; }

/* 左栏工具列表 */
.lc-side {
  width: 230px;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}
.lc-tool {
  padding: 9px 11px;
  border-radius: var(--radius-btn);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.lc-tool:hover { background: var(--bg-card-hover); }
.lc-tool.on { border-color: var(--accent); background: var(--accent-soft); }
.lc-tool-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lc-tool-name { font-size: 12.5px; font-weight: 500; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-tool-ago { font-size: 10.5px; color: var(--text-3); flex-shrink: 0; }
.lc-tool-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 10.5px; color: var(--text-3); }
.m-lines { font-variant-numeric: tabular-nums; }
.m-badge {
  font-size: 9.5px; font-weight: 700;
  padding: 0 5px; border-radius: 7px; line-height: 15px;
}
.m-badge.err { color: var(--danger); background: rgba(255, 93, 93, 0.14); }
.m-badge.warn { color: #E8A33D; background: rgba(232, 163, 61, 0.14); }
.m-size { margin-left: auto; }
.lc-empty-side {
  padding: 26px 12px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
  line-height: 2;
  border: 1px dashed var(--divider-strong);
  border-radius: var(--radius-card);
}

/* 右侧 */
.lc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: var(--radius-card);
  background: var(--bg-card);
  border: 1px solid var(--divider);
  padding: 12px;
}

/* 过滤条 */
.lc-filter { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
.seg {
  display: flex;
  padding: 2px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
}
.seg-item {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--text-3);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
}
.seg-item:hover { color: var(--text-2); }
.seg-item.on { background: var(--bg-elevated); color: var(--text-1); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); }
.seg-count { font-size: 9.5px; padding: 0 5px; border-radius: 8px; background: rgba(255, 93, 93, 0.16); color: var(--danger); line-height: 14px; }
.seg-item.on .seg-count { background: rgba(255, 93, 93, 0.2); }
.lc-range {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-2);
  font-size: 12px;
  outline: none;
}
.lc-search {
  position: relative;
  flex: 1;
  min-width: 140px;
  max-width: 280px;
}
.s-ico { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; opacity: 0.6; pointer-events: none; }
.lc-search input {
  width: 100%;
  height: 28px;
  padding: 0 24px 0 26px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  font-size: 12px;
  color: var(--text-1);
}
.lc-search input:focus { border-color: var(--accent); }
.s-clear {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  width: 18px; height: 18px; border-radius: 50%;
  font-size: 9px; color: var(--text-3);
}
.s-clear:hover { background: var(--bg-card-hover); color: var(--text-1); }

/* 日志流 */
.lc-stream-outer { flex: 1; min-height: 0; display: flex; }
.lc-stream {
  flex: 1;
  overflow-y: auto;
  font-family: Consolas, "Courier New", monospace;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
}
.lc-virtual { position: relative; }
.lc-rows { position: absolute; left: 0; right: 0; top: 0; will-change: transform; }
.lc-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
}
.lc-line:hover { background: var(--bg-card-hover); }
.l-time { color: var(--text-3); font-size: 10px; flex-shrink: 0; width: 74px; font-variant-numeric: tabular-nums; }
.l-lvl {
  flex-shrink: 0;
  width: 52px;
  text-align: center;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1px 0;
  border-radius: 4px;
}
.l-lvl.info { color: #8FA8CC; background: rgba(143, 168, 204, 0.12); }
.l-lvl.success { color: var(--success); background: rgba(53, 199, 89, 0.12); }
.l-lvl.warning { color: #E8A33D; background: rgba(232, 163, 61, 0.14); }
.l-lvl.error { color: var(--danger); background: rgba(255, 93, 93, 0.12); }
.l-text { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; user-select: text; }
.lc-line.error .l-text { color: var(--danger); }
.lc-line.success .l-text { color: var(--success); }
.lc-line.warning .l-text { color: #E8A33D; }
.lc-line :deep(mark) { background: rgba(254, 188, 46, 0.4); color: inherit; border-radius: 2px; padding: 0 1px; }

.lc-empty {
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

/* 底栏 */
.lc-foot { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.lc-stat { font-size: 12px; color: var(--text-3); }
.lc-stat b { color: var(--accent); font-variant-numeric: tabular-nums; }
.lc-foot-btns { display: flex; gap: 6px; }

/* 未选择状态 */
.lc-noselect {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 13px;
}
.ns-ico { font-size: 44px; opacity: 0.5; }
</style>
