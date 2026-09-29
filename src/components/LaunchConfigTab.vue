<script setup>
// 启动配置标签页(工具编辑弹窗第二个标签)
// 功能:新建 / 复制 / 删除 / 设为默认;字段:配置名/args/cwd/env/管理员/运行方式
// 兼容:工具没有任何 launchConfig 时显示「旧版字段模式」提示(行为与 v1 一致)
import { ref, computed } from 'vue'
import {
  s, toast, persist
} from '../composables/store'
import KvEditor from './KvEditor.vue'

const props = defineProps({
  tool: { type: Object, required: true }
})

const qd = window.qd

// cwd 目录选择
async function pickCwd() {
  const p = await qd.pickDirectory()
  if (p && selected.value) {
    selected.value.cwd = p
    save()
  }
}

/* ---- 编辑态(打开时从工具深拷贝;保存时整组写回)---- */
const configs = ref(JSON.parse(JSON.stringify(props.tool.launchConfigs || [])))
const activeId = ref(props.tool.activeLaunchConfigId || (configs.value[0]?.id ?? null))
const selectedId = ref(activeId.value || configs.value[0]?.id || null)

const selected = computed(() => configs.value.find(c => c.id === selectedId.value) || null)
const activeConfig = computed(() => configs.value.find(c => c.id === activeId.value) || null)

// 运行方式四档(lnk 不可用)
const RUN_MODES = [
  { value: 'window', label: '正常窗口', icon: '🪟', note: '弹出独立窗口 / 控制台' },
  { value: 'hidden', label: '隐藏窗口', icon: '👻', note: '后台运行,输出记录到日志' },
  { value: 'log', label: '日志模式', icon: '📋', note: '后台运行 + 自动打开日志面板' },
  { value: 'service', label: '后台服务', icon: '⚙️', note: '独立常驻,退出玄机不结束' }
]

/* ---- CRUD ---- */
function newConfig() {
  const cfg = {
    id: 'lc-' + crypto.randomUUID().slice(0, 8),
    name: `配置 ${configs.value.length + 1}`,
    args: '',
    cwd: '',
    env: {},
    runAsAdmin: false,
    runMode: 'window',
    showWindow: true,
    captureLog: false
  }
  configs.value.push(cfg)
  selectedId.value = cfg.id
  if (!activeId.value) activeId.value = cfg.id   // 第一条自动成为默认
}

function duplicateConfig() {
  const src = selected.value
  if (!src) return
  const copy = { ...JSON.parse(JSON.stringify(src)), id: 'lc-' + crypto.randomUUID().slice(0, 8), name: src.name + ' 副本' }
  configs.value.push(copy)
  selectedId.value = copy.id
}

async function removeConfig() {
  const cfg = selected.value
  if (!cfg) return
  // 只剩一条时不允许删(至少保留一个默认;要回到纯旧字段模式可直接清空内容)
  if (configs.value.length <= 1) { toast('至少保留一条启动配置', 'error'); return }
  configs.value = configs.value.filter(c => c.id !== cfg.id)
  if (activeId.value === cfg.id) activeId.value = configs.value[0]?.id || null
  selectedId.value = activeId.value
  await save()
  toast(`配置「${cfg.name}」已删除`, 'success')
}

function makeActive() {
  if (!selected.value) return
  activeId.value = selected.value.id
  save()
  toast(`「${selected.value.name}」已设为默认`, 'success')
}

// 运行方式联动 showWindow/captureLog(schema 布尔的派生映射)
function setRunMode(mode) {
  if (!selected.value) return
  selected.value.runMode = mode
  selected.value.showWindow = mode === 'window'
  selected.value.captureLog = mode === 'hidden' || mode === 'log'
}

/* ---- 保存(整组写回工具对象)---- */
async function save() {
  // 清理空 env 键
  for (const c of configs.value) {
    if (c.env && typeof c.env === 'object') {
      for (const k of Object.keys(c.env)) {
        if (String(c.env[k]).trim() === '') delete c.env[k]
      }
    }
    // 兜底:确保 schema 字段齐全
    if (!c.runMode) c.runMode = c.showWindow === false ? (c.captureLog ? 'log' : 'hidden') : 'window'
    c.showWindow = c.runMode === 'window'
    c.captureLog = c.runMode === 'hidden' || c.runMode === 'log'
  }
  props.tool.launchConfigs = configs.value
  props.tool.activeLaunchConfigId = activeId.value || configs.value[0]?.id || null
  persist()
}

// 暴露保存给父组件(ToolModal 主保存按钮触发)
defineExpose({ save })
</script>

<template>
  <div class="lc-tab">
    <!-- 配置列表(左侧窄栏)+ 编辑区(右侧) -->
    <div class="lc-layout">
      <!-- 左:配置列表 -->
      <div class="lc-list">
        <button v-for="c in configs" :key="c.id"
                class="lc-item" :class="{ on: selectedId === c.id, active: activeId === c.id }"
                @click="selectedId = c.id">
          <span class="lc-item-name ellipsis">{{ c.name }}</span>
          <span v-if="activeId === c.id" class="lc-active-dot" title="默认配置"></span>
        </button>
        <button class="lc-item lc-new" @click="newConfig">＋ 新建配置</button>
      </div>

      <!-- 右:编辑区 -->
      <div class="lc-editor">
        <template v-if="selected">
          <div class="field">
            <label class="label">配置名称 <i class="req">*</i></label>
            <input v-model="selected.name" class="input" placeholder="如:带代理启动" maxlength="24" @change="save" />
          </div>

          <div class="field">
            <label class="label">启动参数(args)</label>
            <input v-model="selected.args" class="input mono-input" spellcheck="false"
                   placeholder='如:--config=burp-prod.json --port 8080' @change="save" />
          </div>

          <div class="field">
            <label class="label">工作目录(cwd)<em class="label-note">留空 = 目标文件所在目录</em></label>
            <div class="cwd-row">
              <input v-model="selected.cwd" class="input mono-input" spellcheck="false"
                     placeholder="留空 = 目标所在目录" @change="save" />
              <button class="btn" @click="pickCwd">浏览…</button>
            </div>
          </div>

          <div class="field">
            <label class="label">环境变量(env)</label>
            <KvEditor v-model="selected.env" key-placeholder="如 JAVA_HOME" value-placeholder="如 C:\jdk-17" @update:modelValue="save" />
          </div>

          <div class="field">
            <label class="label">运行方式</label>
            <div class="mode-grid">
              <button v-for="m in RUN_MODES" :key="m.value" type="button"
                      class="mode-item" :class="{ on: selected.runMode === m.value }"
                      @click="setRunMode(m.value)">
                <span class="mode-icon">{{ m.icon }}</span>
                <span class="mode-text">{{ m.label }}<em>{{ m.note }}</em></span>
                <span class="mode-dot"></span>
              </button>
            </div>
            <div class="opts" style="margin-top: 8px;">
              <button type="button" class="opt-row" @click="selected.runAsAdmin = !selected.runAsAdmin; save()">
                <span class="qd-switch" :class="{ on: selected.runAsAdmin }"></span>
                <span class="opt-text">以管理员运行 <em class="opt-note">ShellExecute runas · UAC 确认</em></span>
              </button>
            </div>
          </div>

          <div class="lc-actions">
            <button v-if="activeId !== selected.id" class="btn" @click="makeActive">设为默认</button>
            <button class="btn" @click="duplicateConfig">📋 复制</button>
            <button class="btn btn-danger" @click="removeConfig">删除</button>
          </div>
        </template>

        <div v-else class="lc-none">
          <p>还没有启动配置</p>
          <button class="btn btn-primary" @click="newConfig">＋ 新建第一条</button>
        </div>
      </div>
    </div>

    <p class="lc-hint">💡 工具卡片单击 = 以默认配置运行;「⋯」菜单可临时选择其他配置运行。某字段留空时自动回落到工具基础设置。</p>
  </div>
</template>

<style scoped>
.lc-tab { display: flex; flex-direction: column; gap: 10px; }
.lc-layout { display: flex; gap: 12px; min-height: 320px; }

/* 左:配置列表 */
.lc-list {
  width: 148px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: flex-start;
}
.lc-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  font-size: 12px;
  color: var(--text-2);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.lc-item:hover { background: var(--bg-input-hover); color: var(--text-1); }
.lc-item.on { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.4); }
.lc-item-name { flex: 1; min-width: 0; }
.lc-active-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
.lc-new { color: var(--text-3); border: 1px dashed var(--divider-strong); }
.lc-new:hover { color: var(--accent); border-color: var(--accent); }

/* 右:编辑区 */
.lc-editor { flex: 1; min-width: 0; }
.field { margin-bottom: 12px; }
.label { display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--text-2); margin-bottom: 6px; font-weight: 500; }
.label-note { font-style: normal; font-size: 10.5px; color: var(--text-3); font-weight: 400; }
.req { color: var(--danger); font-style: normal; }
.mono-input { font-family: Consolas, monospace; font-size: 12px; }
.cwd-row { display: flex; gap: 8px; }
.cwd-row .input { flex: 1; }

.mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mode-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  text-align: left;
  transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.mode-item:hover { background: var(--bg-input-hover); }
.mode-item:active { transform: scale(0.98); }
.mode-item.on { background: var(--accent-soft); box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.45); }
.mode-icon { font-size: 15px; flex-shrink: 0; }
.mode-text { font-size: 12px; color: var(--text-1); display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.mode-text em { font-style: normal; font-size: 10.5px; color: var(--text-3); line-height: 1.4; }
.mode-dot {
  position: absolute;
  top: 9px; right: 9px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--divider-strong);
  transition: background var(--dur-fast) var(--ease);
}
.mode-item.on .mode-dot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

.opts { display: flex; flex-direction: column; gap: 2px; }
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-btn);
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.opt-row:hover { background: var(--bg-input); }
.opt-text { font-size: 12.5px; color: var(--text-1); display: flex; flex-direction: column; gap: 1px; }
.opt-note { font-style: normal; font-size: 11px; color: var(--text-3); }

.lc-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.lc-none {
  height: 100%;
  min-height: 220px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
  color: var(--text-3);
  font-size: 12.5px;
}
.lc-hint { font-size: 11px; color: var(--text-3); line-height: 1.6; }
</style>
