<script setup>
// 设置页:外观 / 窗口行为 / 使用报告 / 工具健康 / 沉睡工具 / 数据管理
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  s, applyTheme, persist, toast, weeklyStats, sleepyTools, todayRunCount,
  relativeTime, totalCount, confirmBox
} from '../composables/store'
import { setDockMode, ensureDockSettings } from '../stores/dockStore'
import { healthChecks, reloadChecks, createCheck, updateCheck, deleteCheck } from '../stores/healthStore'
import ToolIcon from './ToolIcon.vue'

const qd = window.qd

const THEMES = [
  { value: 'dark', label: '深色', icon: '🌙' },
  { value: 'light', label: '浅色', icon: '☀️' },
  { value: 'system', label: '跟随系统', icon: '🖥' }
]

// v2.1:Dock 三档模式
const DOCK_MODES = [
  { value: 'auto', label: '自动隐藏', icon: '👻', desc: '平时隐藏;鼠标移到窗口底部边缘滑出,离开后 0.4 秒收回' },
  { value: 'fixed', label: '常驻', icon: '📌', desc: '固定显示在底部;内容区自动预留空间,滚动不被遮挡' },
  { value: 'off', label: '关闭', icon: '🚫', desc: '完全关闭 Dock 与触发区,等同没有这个功能' }
]

// v2.0:启动默认页(home 首页 / all 全部工具 / last 上次视图)
const VIEWS = [
  { value: 'home', label: '首页', icon: '🏠' },
  { value: 'all', label: '全部工具', icon: '🧰' },
  { value: 'last', label: '上次视图', icon: '🕘' }
]

function setDefaultView(v) {
  s.data.settings.defaultView = v
  persist()
}

function setTheme(v) { applyTheme(v) }

function setCloseToTray(v) {
  s.data.settings.closeToTray = v
  // settings 含嵌套对象(dock),须深拷贝过 IPC(浅拷贝会残留嵌套 Proxy)
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  persist()
}

async function openDataDir() {
  await qd.showInFolder(s.appInfo.dataDir)
}

async function openLog() {
  await qd.openLogFile()
}

async function exportCfg() {
  // 安全红线:导出前提示可能包含敏感数据
  const ok = await confirmBox({
    title: '导出配置',
    message: '导出的配置可能包含内网地址、目标信息等敏感数据,请注意保管。',
    detail: '建议仅在本地备份或加密传输,不要把导出文件发给不可信的第三方。',
    confirmText: '仍然导出'
  })
  if (!ok) return
  const r = await qd.exportConfig(JSON.parse(JSON.stringify(s.data)))
  if (r.ok) toast(`配置已导出到 ${r.path}`, 'success')
}

async function importCfg() {
  const data = await qd.importConfig()
  if (!data) return
  if (data.error) { toast(data.error, 'error'); return }
  if (!data.tools || !data.categories) { toast('配置文件格式不正确', 'error'); return }
  s.data = {
    version: data.version || '2.1',
    categories: data.categories,
    tools: data.tools,
    settings: Object.assign(s.data.settings, data.settings || {})
  }
  ensureDockSettings()   // 导入的 settings 可能缺 dock 字段(或含旧 showDock),兜底映射
  await qd.storeSave(JSON.parse(JSON.stringify(s.data)))
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))  // 深拷贝:嵌套 dock 对象不能带 Proxy
  applyTheme(s.data.settings.theme)
  toast('配置已导入', 'success')
  runHealthCheck()   // 导入后重新体检
}

/* ---- 使用报告:近 7 天 Top 5 ---- */
const topWeek = computed(() => weeklyStats.value.slice(0, 5))
const maxWeek = computed(() => topWeek.value[0]?.n || 1)
const weekActiveCount = computed(() => weeklyStats.value.length)

/* ---- 工具健康检查:全库扫描目标文件存在性 ---- */
const health = ref({ checking: false, missing: [], checkedAt: null })
async function runHealthCheck() {
  health.value.checking = true
  const missing = []
  for (const t of s.data.tools) {
    if (!(await qd.fsExists(t.targetPath))) missing.push(t)
  }
  health.value = { checking: false, missing, checkedAt: new Date() }
}
onMounted(() => {
  runHealthCheck()
  reloadChecks()   // v2.1:环境检查模板列表
  offShortcut = qd.onShortcutResult(onShortcutResult)   // v2.2.0:快捷键注册结果反馈
})

/* ---- v2.2.0 全局呼出快捷键(录制式自定义) ---- */
const recording = ref(false)
const shortcutTip = ref(null)   // { text, warn }
let offShortcut = null

function fmtAcc(a) { return (a || '').replace(/Control\+/g, 'Ctrl+') }

function onShortcutResult(r) {
  if (!r) return
  if (r.disabled) { shortcutTip.value = { text: '已禁用全局呼出' }; return }
  shortcutTip.value = r.ok
    ? { text: `已生效:${fmtAcc(r.accelerator)}` }
    : { text: r.message || '注册失败', warn: true }
}

function toggleRecord() {
  if (recording.value) { stopRecord(); return }
  recording.value = true
  shortcutTip.value = { text: '请按下新的组合键(Esc 取消)' }
  window.addEventListener('keydown', onRecKey, true)
}

function stopRecord() {
  recording.value = false
  window.removeEventListener('keydown', onRecKey, true)
  if (shortcutTip.value && /请按下/.test(shortcutTip.value.text)) shortcutTip.value = null
}

// 按键 → Electron accelerator(用 e.code 避开输入法干扰)
function onRecKey(e) {
  e.preventDefault(); e.stopPropagation()
  if (e.key === 'Escape') { stopRecord(); return }
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return   // 纯修饰键等待主键
  const mod = []
  if (e.ctrlKey) mod.push('Control')
  if (e.altKey) mod.push('Alt')
  if (e.shiftKey) mod.push('Shift')
  if (e.metaKey) mod.push('Super')
  let key = e.code || ''
  if (key.startsWith('Key')) key = key.slice(3)               // KeyA → A
  else if (key.startsWith('Digit')) key = key.slice(5)        // Digit1 → 1
  else if (key === 'Space') key = 'Space'
  else if (/^F\d+$/.test(key)) { /* F1~F12 原样 */ }
  else key = (e.key || '').toUpperCase()
  if (!key) return
  if (!mod.length) { shortcutTip.value = { text: '需包含 Ctrl / Alt / Shift 至少一个修饰键(避免拦截普通按键)', warn: true }; return }
  stopRecord()
  saveShortcut([...mod, key].join('+'))
}

async function saveShortcut(acc) {
  s.data.settings.globalShortcut = acc
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  persist()
  // 注册结果经 shortcut:result 推送回来(onShortcutResult 弹提示)
  if (acc) toast(`正在设置呼出键 ${fmtAcc(acc)}…`, 'info', 2000)
}

onUnmounted(() => {
  if (recording.value) stopRecord()
  offShortcut?.()
})

/* ---- v2.1 日志中心设置 ---- */
const logErrText = ref((s.data.settings.log?.errorPatterns || []).join('\n'))
const logWarnText = ref((s.data.settings.log?.warnPatterns || []).join('\n'))
const retentionDays = ref(s.data.settings.log?.retentionDays || 14)
const maxFileSizeMB = ref(s.data.settings.log?.maxFileSizeMB || 5)

function saveLogSettings() {
  const parse = (t) => t.split('\n').map(x => x.trim()).filter(Boolean)
  s.data.settings.log = {
    errorPatterns: parse(logErrText.value),
    warnPatterns: parse(logWarnText.value),
    retentionDays: Math.min(365, Math.max(1, Number(retentionDays.value) || 14)),
    maxFileSizeMB: Math.min(100, Math.max(1, Number(maxFileSizeMB.value) || 5))
  }
  // 深拷贝过 IPC(settings:sync 时主进程 logstore.configure 热更新等级判定)
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  persist()
  toast('日志设置已保存并即时生效', 'success')
}

/* ---- v2.1 环境健康检查 ---- */
const CHK_TYPES = [
  { value: 'exec', label: '命令检测' },
  { value: 'port', label: '端口检测' },
  { value: 'file', label: '文件检测' }
]
const chkModal = ref({ open: false, editId: null })
const chkForm = ref({ name: '', type: 'exec', command: '', expectRegex: '', timeoutMs: 8000, host: '127.0.0.1', port: 0, path: '', fixTip: '' })
// 挂载统计:checkId → 引用工具数
const chkUsage = computed(() => {
  const m = {}
  for (const t of s.data.tools) {
    for (const id of t.checkIds || []) m[id] = (m[id] || 0) + 1
  }
  return m
})

function openChkCreate() {
  chkForm.value = { name: '', type: 'exec', command: '', expectRegex: '', timeoutMs: 8000, host: '127.0.0.1', port: 0, path: '', fixTip: '' }
  chkModal.value = { open: true, editId: null }
}
function openChkEdit(c) {
  chkForm.value = {
    name: c.name, type: c.type, command: c.command || '', expectRegex: c.expectRegex || '',
    timeoutMs: c.timeoutMs || 8000, host: c.host || '127.0.0.1', port: c.port || 0,
    path: c.path || '', fixTip: c.fixTip || ''
  }
  chkModal.value = { open: true, editId: c.id }
}

async function saveChk() {
  const f = chkForm.value
  if (!f.name.trim()) { toast('检查名称不能为空', 'error'); return }
  if (f.type === 'exec' && !f.command.trim()) { toast('命令检测需要填写检测命令', 'error'); return }
  if (f.type === 'port' && (!f.port || f.port < 1)) { toast('端口检测需要填写有效端口', 'error'); return }
  if (f.type === 'file' && !f.path.trim()) { toast('文件检测需要填写路径', 'error'); return }
  if (chkModal.value.editId) {
    await updateCheck(chkModal.value.editId, f)
    toast('检查模板已更新(缓存已失效)', 'success')
  } else {
    await createCheck(f)
    toast('检查模板已创建', 'success')
  }
  chkModal.value.open = false
}

async function removeChk(c) {
  const n = chkUsage.value[c.id] || 0
  const yes = await confirmBox({
    title: '删除检查模板',
    message: `删除「${c.name}」?`,
    detail: n ? `当前有 ${n} 个工具挂载了此检查,删除后将自动解除挂载。` : '没有工具挂载此检查。',
    confirmText: '删除'
  })
  if (!yes) return
  await deleteCheck(c.id)
  toast('检查模板已删除', 'success')
}

// 预设按钮:一键测试某模板(立即真实执行,不走缓存)
const chkTesting = ref('')
async function testChk(c) {
  chkTesting.value = c.id
  const r = await qd.healthRun({ checkIds: [c.id], force: true })
  chkTesting.value = ''
  const item = (r || [])[0]
  if (item?.ok) toast(`✓ ${item.name}:${item.message}`, 'success')
  else toast(`✕ ${item?.name || '检测'}:${item?.message || '无结果'}`, 'error', 5000)
}

function setBlockOnFail(v) {
  s.data.settings.healthCheck.blockOnFail = v
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  persist()
  toast(v ? '红项将拦截启动(可在拦截面板强制跳过)' : '红项仅提示不拦截启动', 'success')
}
function setCacheTtl(v) {
  s.data.settings.healthCheck.cacheTtlSec = Math.min(3600, Math.max(0, Number(v) || 300))
  qd.syncSettings(JSON.parse(JSON.stringify(s.data.settings)))
  persist()
}

const healthOk = computed(() => !health.value.checking && health.value.checkedAt && health.value.missing.length === 0)
</script>

<template>
  <div class="settings scroll-area">
    <div class="settings-body">
      <!-- 外观 -->
      <section class="card">
        <h4 class="card-title">外观</h4>
        <div class="row">
          <div class="row-main">
            <div class="row-name">主题</div>
            <div class="row-desc">深色毛玻璃 / 浅色 / 跟随系统</div>
          </div>
          <div class="seg">
            <button v-for="t in THEMES" :key="t.value" class="seg-item"
                    :class="{ on: s.data.settings.theme === t.value }" @click="setTheme(t.value)">
              {{ t.icon }} {{ t.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- 行为 -->
      <section class="card">
        <h4 class="card-title">窗口行为</h4>
        <div class="row">
          <div class="row-main">
            <div class="row-name">启动默认页</div>
            <div class="row-desc">应用启动时首先进入的页面</div>
          </div>
          <div class="seg">
            <button v-for="v in VIEWS" :key="v.value" class="seg-item"
                    :class="{ on: (s.data.settings.defaultView || 'home') === v.value }"
                    @click="setDefaultView(v.value)">
              {{ v.icon }} {{ v.label }}
            </button>
          </div>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">关闭时最小化到托盘</div>
            <div class="row-desc">点击关闭按钮时隐藏到系统托盘,而不是退出</div>
          </div>
          <button class="qd-switch" :class="{ on: s.data.settings.closeToTray }"
                  @click="setCloseToTray(!s.data.settings.closeToTray)"></button>
        </div>
        <!-- v2.2.0 全局呼出快捷键(录制式自定义;默认 Ctrl+Space 与输入法中英文切换冲突) -->
        <div class="row">
          <div class="row-main">
            <div class="row-name">全局呼出快捷键</div>
            <div class="row-desc">任意界面一键呼出/隐藏玄机并聚焦命令面板(最小化到托盘时同样生效)</div>
            <div v-if="shortcutTip" class="row-desc" :class="{ 'sc-warn': shortcutTip.warn }">{{ shortcutTip.text }}</div>
            <div v-else-if="s.data.settings.globalShortcut" class="row-desc">当前:{{ fmtAcc(s.data.settings.globalShortcut) }} · 默认 Ctrl+Space(与输入法中英文切换冲突时可改键)</div>
          </div>
          <div class="sc-actions">
            <button class="sc-btn" :class="{ recording: recording }" @click="toggleRecord">
              {{ recording ? '按下组合键…' : (s.data.settings.globalShortcut ? fmtAcc(s.data.settings.globalShortcut) : '已禁用') }}
            </button>
            <button v-if="s.data.settings.globalShortcut" class="sc-btn ghost" title="不注册任何全局呼出键"
                    @click="saveShortcut('')">禁用</button>
            <button v-if="s.data.settings.globalShortcut && s.data.settings.globalShortcut !== 'Control+Space'"
                    class="sc-btn ghost" @click="saveShortcut('Control+Space')">默认</button>
          </div>
        </div>
      </section>

      <!-- Dock(v2.1:三档模式,替代旧「显示底部 Dock」开关) -->
      <section class="card">
        <h4 class="card-title">Dock</h4>
        <div class="row">
          <div class="row-main">
            <div class="row-name">显示模式</div>
            <div class="row-desc">{{ (DOCK_MODES.find(m => m.value === (s.data.settings.dock?.mode || 'auto')) || DOCK_MODES[0]).desc }}</div>
          </div>
          <div class="seg">
            <button v-for="m in DOCK_MODES" :key="m.value" class="seg-item"
                    :class="{ on: (s.data.settings.dock?.mode || 'auto') === m.value }"
                    @click="setDockMode(m.value)">
              {{ m.icon }} {{ m.label }}
            </button>
          </div>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">固定管理</div>
            <div class="row-desc">右键工具卡片「固定到 Dock」;Dock 内可拖拽排序、右键移除,上限 10 个</div>
          </div>
        </div>
      </section>

      <!-- 使用报告 -->
      <section class="card">
        <h4 class="card-title">使用报告 · 近 7 天</h4>
        <div class="stat-strip">
          <div class="stat">
            <div class="stat-n">{{ totalCount }}</div>
            <div class="stat-label">工具总数</div>
          </div>
          <div class="stat">
            <div class="stat-n">{{ todayRunCount }}</div>
            <div class="stat-label">今日启动</div>
          </div>
          <div class="stat">
            <div class="stat-n">{{ weekActiveCount }}</div>
            <div class="stat-label">本周活跃工具</div>
          </div>
        </div>
        <div v-if="topWeek.length" class="week-bars">
          <div v-for="x in topWeek" :key="x.tool.id" class="bar-row" :title="x.tool.targetPath">
            <span class="bar-name ellipsis">{{ x.tool.name }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: Math.max(6, Math.round(x.n / maxWeek * 100)) + '%' }"></div>
            </div>
            <span class="bar-n">{{ x.n }} 次</span>
          </div>
        </div>
        <p v-else class="empty-note">本周还没有启动记录,去跑一个工具吧</p>
      </section>

      <!-- 工具健康检查 -->
      <section class="card">
        <div class="card-head">
          <h4 class="card-title">工具健康检查</h4>
          <button class="btn btn-sm" :disabled="health.checking" @click="runHealthCheck">
            {{ health.checking ? '检查中…' : '重新检查' }}
          </button>
        </div>
        <div v-if="health.checking" class="empty-note">正在逐个核对 {{ totalCount }} 个工具的目标文件…</div>
        <div v-else-if="healthOk" class="health-ok">✓ 全部 {{ totalCount }} 个工具的目标文件都在,状态良好</div>
        <div v-else-if="health.checkedAt" class="health-bad">
          <div class="hb-head">⚠ {{ health.missing.length }} 个工具的目标文件已丢失</div>
          <div v-for="t in health.missing" :key="t.id" class="hb-item">
            <ToolIcon :tool="t" :size="18" />
            <div class="hb-info">
              <div class="hb-name">{{ t.name }}</div>
              <div class="hb-path mono">{{ t.targetPath }}</div>
            </div>
            <button class="btn btn-sm" @click="qd.showInFolder(t.targetPath)">打开目录</button>
          </div>
          <p class="empty-note" style="margin-top: 8px;">文件可能被移动、重命名或卸载;可编辑工具更新路径,或删除失效条目</p>
        </div>
      </section>

      <!-- 日志中心(v2.1) -->
      <section class="card">
        <div class="card-head">
          <h4 class="card-title">日志中心</h4>
          <button class="btn btn-sm" @click="qd.logOpenDir()">打开日志目录</button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">日志保留天数</div>
            <div class="row-desc">超期日志文件在启动与每 6 小时巡检时自动清理(1-365 天)</div>
          </div>
          <input v-model="retentionDays" type="number" min="1" max="365" class="num-input" @change="saveLogSettings" />
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">单文件大小上限(MB)</div>
            <div class="row-desc">超过后轮转为 .1.jsonl 历史文件,仅保留一代(1-100)</div>
          </div>
          <input v-model="maxFileSizeMB" type="number" min="1" max="100" class="num-input" @change="saveLogSettings" />
        </div>
        <div class="row col">
          <div class="row-main">
            <div class="row-name">ERROR 判定关键字(正则,每行一条)</div>
            <div class="row-desc">INFO 级输出命中任一条即判为 ERROR;不合法的行会被忽略</div>
          </div>
          <textarea v-model="logErrText" class="pat-input mono" rows="4" spellcheck="false"
                    placeholder="\berror&#10;\bfatal&#10;exception" @change="saveLogSettings"></textarea>
        </div>
        <div class="row col">
          <div class="row-main">
            <div class="row-name">WARN 判定关键字(正则,每行一条)</div>
            <div class="row-desc">优先级低于 ERROR;用于把普通输出降级标记为警告</div>
          </div>
          <textarea v-model="logWarnText" class="pat-input mono" rows="3" spellcheck="false"
                    placeholder="\bwarn&#10;警告&#10;deprecated" @change="saveLogSettings"></textarea>
        </div>
      </section>

      <!-- 环境健康检查(v2.1) -->
      <section class="card">
        <div class="card-head">
          <h4 class="card-title">环境健康检查</h4>
          <button class="btn btn-sm" @click="openChkCreate">＋ 新建检查</button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">红项拦截启动</div>
            <div class="row-desc">开启后:挂载检查的工具启动前先跑检查,存在红项时弹面板阻止(可强制跳过)</div>
          </div>
          <button class="qd-switch" :class="{ on: s.data.settings.healthCheck?.blockOnFail !== false }"
                  @click="setBlockOnFail(!(s.data.settings.healthCheck?.blockOnFail !== false))"></button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">结果缓存(秒)</div>
            <div class="row-desc">0-3600;检查结果在缓存期内直接复用,修改模板后自动失效</div>
          </div>
          <input type="number" min="0" max="3600" class="num-input"
                 :value="s.data.settings.healthCheck?.cacheTtlSec ?? 300"
                 @change="setCacheTtl($event.target.value)" />
        </div>

        <div v-if="healthChecks.list.length" class="chk-list">
          <div v-for="c in healthChecks.list" :key="c.id" class="chk-row">
            <div class="chk-main">
              <div class="chk-name">
                {{ c.name }}
                <span class="chk-type">{{ { exec: '命令', port: '端口', file: '文件' }[c.type] }}</span>
                <span v-if="chkUsage[c.id]" class="chk-usage">{{ chkUsage[c.id] }} 个工具挂载</span>
              </div>
              <div class="chk-detail mono">
                {{ c.type === 'exec' ? c.command : c.type === 'port' ? `${c.host}:${c.port}` : c.path }}
                <template v-if="c.type === 'exec' && c.expectRegex"> · 期望 /{{ c.expectRegex }}/i</template>
              </div>
            </div>
            <div class="chk-acts">
              <button class="btn btn-sm" :disabled="chkTesting === c.id" @click="testChk(c)">{{ chkTesting === c.id ? '检测中…' : '测试' }}</button>
              <button class="btn btn-sm" @click="openChkEdit(c)">编辑</button>
              <button class="btn btn-sm btn-danger-ghost" @click="removeChk(c)">删除</button>
            </div>
          </div>
        </div>
        <p v-else class="empty-note">还没有检查模板。点击「新建检查」添加;内置预设(Java/Python/pip/Git)已随 v2.1 迁移种子写入。</p>
        <p class="empty-note">挂载方式:编辑工具 → 「环境检查」标签页勾选;启动挂载工具时自动执行。</p>
      </section>

      <!-- 沉睡工具:超过 30 天未启动 -->
      <section class="card">
        <h4 class="card-title">沉睡工具 · 30 天未用</h4>
        <div v-if="sleepyTools.length" class="sleep-list">
          <div v-for="t in sleepyTools" :key="t.id" class="sleep-item" :title="t.targetPath">
            <ToolIcon :tool="t" :size="20" />
            <span class="si-name ellipsis">{{ t.name }}</span>
            <span class="si-time">最后启动 {{ relativeTime(t.lastRunAt) }}</span>
          </div>
        </div>
        <p v-else class="empty-note">没有沉睡的工具,全部都在活跃使用 ✓</p>
      </section>

      <!-- 数据 -->
      <section class="card">
        <h4 class="card-title">数据</h4>
        <div class="row">
          <div class="row-main">
            <div class="row-name">数据目录</div>
            <div class="row-desc mono">{{ s.appInfo.dataDir }}</div>
          </div>
          <button class="btn" @click="openDataDir">打开目录</button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">应用日志</div>
            <div class="row-desc mono">{{ s.appInfo.logFile || (s.appInfo.dataDir + '\\app.log') }}</div>
            <div class="row-desc">追加写入,单份超 2MB 自动轮转,保留最近 5 份历史</div>
          </div>
          <button class="btn" @click="openLog">打开日志</button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">导出配置</div>
            <div class="row-desc">将分类与工具配置导出为 JSON 文件</div>
          </div>
          <button class="btn" @click="exportCfg">导出…</button>
        </div>
        <div class="row">
          <div class="row-main">
            <div class="row-name">导入配置</div>
            <div class="row-desc">从 JSON 文件恢复配置(覆盖当前数据)</div>
          </div>
          <button class="btn" @click="importCfg">导入…</button>
        </div>
      </section>

      <!-- v2.1 检查模板编辑弹窗 -->
      <Transition name="modal-mask">
        <div v-if="chkModal.open" class="set-mask" @mousedown.self="chkModal.open = false">
          <div class="set-box">
            <h3>{{ chkModal.editId ? '编辑检查模板' : '新建检查模板' }}</h3>
            <div class="f-row2">
              <input v-model="chkForm.name" class="f-input" placeholder="检查名称 *" spellcheck="false" />
              <select v-model="chkForm.type" class="f-input f-select">
                <option v-for="t in CHK_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>
            <template v-if="chkForm.type === 'exec'">
              <input v-model="chkForm.command" class="f-input mono" placeholder="检测命令,如:java -version" spellcheck="false" />
              <div class="f-row2">
                <input v-model="chkForm.expectRegex" class="f-input mono" placeholder="期望输出正则(留空 = 退出码 0 即通过)" spellcheck="false" />
                <input v-model.number="chkForm.timeoutMs" type="number" min="1000" max="30000" class="f-input" placeholder="超时 ms" />
              </div>
            </template>
            <template v-else-if="chkForm.type === 'port'">
              <div class="f-row2">
                <input v-model="chkForm.host" class="f-input mono" placeholder="主机(默认 127.0.0.1)" spellcheck="false" />
                <input v-model.number="chkForm.port" type="number" min="1" max="65535" class="f-input" placeholder="端口 *" />
              </div>
            </template>
            <template v-else>
              <input v-model="chkForm.path" class="f-input mono" placeholder="检测路径 *" spellcheck="false" />
            </template>
            <input v-model="chkForm.fixTip" class="f-input" placeholder="修复建议(红项时展示,如:请安装 JDK 并配置 JAVA_HOME)" spellcheck="false" />
            <div class="rc-box-foot">
              <button class="btn" @click="chkModal.open = false">取消</button>
              <button class="btn btn-primary" @click="saveChk">保存</button>
            </div>
          </div>
        </div>
      </Transition>

      <p class="about">
        玄机 v{{ s.appInfo.version }} · 纯本地运行,不联网、不上传任何数据
        <template v-if="s.appInfo.win11"> · 已启用系统 Mica/Acrylic 材质</template>
        <template v-else> · CSS 毛玻璃降级模式</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings { flex: 1; overflow-y: auto; padding: 8px 24px 88px; }
.settings-body { max-width: 640px; margin: 0 auto; }

.card {
  background: var(--bg-card);
  border-radius: var(--radius-card);
  box-shadow: inset 0 0 0 1px var(--divider);
  padding: 16px 18px;
  margin-bottom: 14px;
  animation: enter-fade-up 300ms var(--ease) both;
}
.card:nth-child(1) { animation-delay: 0ms; }
.card:nth-child(2) { animation-delay: 40ms; }
.card:nth-child(3) { animation-delay: 80ms; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 6px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.card-head .card-title { margin-bottom: 0; }
.btn-sm { height: 26px; padding: 0 12px; font-size: 11.5px; flex-shrink: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: Consolas, monospace; }

/* ---- 使用报告 ---- */
.stat-strip { display: flex; gap: 10px; margin: 10px 0 14px; }
.stat {
  flex: 1;
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  text-align: center;
}
.stat-n { font-size: 22px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.stat-label { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.week-bars { display: flex; flex-direction: column; gap: 7px; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-name { width: 110px; flex-shrink: 0; font-size: 12px; color: var(--text-2); text-align: right; }
.bar-track {
  flex: 1;
  height: 14px;
  border-radius: 7px;
  background: var(--bg-input);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 7px;
  background: linear-gradient(90deg, #4F8CFF, #7B5CFF);
  transition: width 500ms var(--ease);
}
.bar-n { width: 44px; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.empty-note { font-size: 12px; color: var(--text-3); padding: 6px 0; }

/* ---- 健康检查 ---- */
.health-ok {
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  background: rgba(76, 175, 80, 0.1);
  color: var(--success, #4CAF50);
  font-size: 12.5px;
}
.health-bad {
  padding: 12px 14px;
  border-radius: var(--radius-btn);
  background: rgba(254, 188, 46, 0.08);
}
.hb-head { font-size: 12.5px; color: var(--warning, #FEBC2E); font-weight: 600; margin-bottom: 8px; }
.hb-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--divider);
}
.hb-item:last-of-type { border-bottom: none; }
.hb-info { flex: 1; min-width: 0; }
.hb-name { font-size: 12.5px; color: var(--text-1); }
.hb-path { font-size: 11px; color: var(--text-3); margin-top: 2px; word-break: break-all; }

/* ---- 沉睡工具 ---- */
.sleep-list { display: flex; flex-direction: column; }
.sleep-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider);
}
.sleep-item:last-child { border-bottom: none; }
.si-name { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text-1); }
.si-time { font-size: 11px; color: var(--text-3); flex-shrink: 0; }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid var(--divider);
}
.row:last-child { border-bottom: none; padding-bottom: 2px; }
.row.col { flex-direction: column; align-items: stretch; gap: 8px; }
.row-main { min-width: 0; }
.row-name { font-size: 13.5px; color: var(--text-1); }
.row-desc { font-size: 11.5px; color: var(--text-3); margin-top: 3px; word-break: break-all; }
.row-desc.mono { font-family: Consolas, monospace; font-size: 11px; }
.row-desc.sc-warn { color: var(--warning); }

/* v2.2.0 全局呼出快捷键 */
.sc-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.sc-btn {
  min-width: 96px; padding: 5px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-input); color: var(--text-1);
  font-family: Consolas, monospace; font-size: 12px; cursor: pointer; transition: all .15s;
}
.sc-btn:hover { border-color: var(--accent); }
.sc-btn.recording { border-color: var(--accent); color: var(--accent); animation: sc-blink 1s infinite; }
@keyframes sc-blink { 50% { opacity: .55; } }
.sc-btn.ghost { min-width: auto; padding: 5px 10px; color: var(--text-3); font-family: inherit; }

/* v2.1 日志设置:数字输入与正则多行编辑 */
.num-input {
  width: 84px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-1);
  font-size: 12.5px;
  text-align: center;
  flex-shrink: 0;
}
.num-input:focus { border-color: var(--accent); outline: none; }
.pat-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  border: 1px solid transparent;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.7;
  resize: vertical;
}
.pat-input:focus { border-color: var(--accent); outline: none; }
.pat-input.mono { font-family: Consolas, monospace; }

/* v2.1 环境检查模板列表与弹窗 */
.chk-list { display: flex; flex-direction: column; margin-top: 4px; }
.chk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--divider);
}
.chk-row:last-child { border-bottom: none; }
.chk-main { flex: 1; min-width: 0; }
.chk-name { font-size: 12.5px; color: var(--text-1); display: flex; align-items: center; gap: 6px; }
.chk-type {
  font-size: 9.5px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 7px;
}
.chk-usage { font-size: 10px; color: var(--accent); }
.chk-detail {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chk-acts { display: flex; gap: 5px; flex-shrink: 0; }
.btn-danger-ghost { color: var(--danger); }
.btn-danger-ghost:hover { background: rgba(255, 93, 93, 0.1); }
.set-mask {
  position: fixed; inset: 0;
  z-index: 155;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px) saturate(1.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.set-box {
  width: 460px;
  max-width: calc(100vw - 48px);
  border-radius: 16px;
  background: var(--bg-elevated);
  backdrop-filter: blur(36px) saturate(1.7);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.set-box h3 { font-size: 15px; font-weight: 600; }
.f-row2 { display: flex; gap: 8px; }
.f-select { appearance: auto; }
.rc-box-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

.seg {
  display: flex;
  padding: 2px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  flex-shrink: 0;
}
.seg-item {
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-3);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.seg-item:hover { color: var(--text-2); }
.seg-item.on { background: var(--bg-elevated); color: var(--text-1); box-shadow: 0 1px 4px rgba(0,0,0,.25); }

.about {
  text-align: center;
  font-size: 11.5px;
  color: var(--text-3);
  padding: 18px 0 8px;
}
</style>
