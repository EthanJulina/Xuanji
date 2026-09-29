<script setup>
// 添加/编辑工具弹窗(v2.0 标签页化)
// 标签 1「基础」:名称 / 目标文件 / 分类 / 备注 / 图标 / 置顶 / 运行选项(顶层旧字段)
// 标签 2「启动配置」:多条 launchConfig 管理(LaunchConfigTab 组件)
import { ref, computed, watch, nextTick } from 'vue'
import {
  s, toolById, addTool, updateTool, addCategory, sortedCategories, persist, toast
} from '../composables/store'
import CustomSelect from './CustomSelect.vue'
import EmojiPicker from './EmojiPicker.vue'
import ToolIcon from './ToolIcon.vue'
import LaunchConfigTab from './LaunchConfigTab.vue'
import EnvCheckTab from './EnvCheckTab.vue'

const qd = window.qd

const isEdit = computed(() => !!s.toolModal.editId)
const editing = computed(() => isEdit.value ? toolById(s.toolModal.editId) : null)
// 当前标签:basic | launch(仅编辑模式显示启动配置标签)
const tab = computed({
  get: () => s.toolModal.tab || 'basic',
  set: (v) => { s.toolModal.tab = v }
})
const launchTabRef = ref(null)

/* ---- 表单状态 ---- */
const form = ref(defaultForm())
const saving = ref(false)
const nameInvalid = ref(false)
const pathInvalid = ref(false)

function defaultForm() {
  return {
    name: '',
    targetPath: '',
    type: null,            // bat|cmd|lnk|exe
    desc: '',
    categoryId: null,
    iconKind: 'auto',      // auto | emoji | img
    emoji: '🧰',
    imgData: null,
    pinned: false,
    runMode: 'window',     // window 正常窗口 | hidden 隐藏窗口 | log 日志模式 | service 后台服务
    runAsAdmin: false,
    confirmBeforeRun: false
  }
}

// 运行方式四档定义(lnk 不可用时整组禁用)
const RUN_MODES = [
  { value: 'window', label: '正常窗口', icon: '🪟', note: '弹出独立窗口 / 控制台运行' },
  { value: 'hidden', label: '隐藏窗口', icon: '👻', note: '后台运行,输出记录到日志面板' },
  { value: 'log', label: '日志模式', icon: '📋', note: '后台运行 + 自动打开日志面板实时查看' },
  { value: 'service', label: '后台服务', icon: '⚙️', note: '独立常驻,退出玄机不会结束它' }
]

// 打开时填充
watch(() => s.toolModal.open, (open) => {
  if (!open) return
  nameInvalid.value = false
  pathInvalid.value = false
  tab.value = 'basic'   // 每次打开回到基础标签
  if (editing.value) {
    const t = editing.value
    form.value = {
      name: t.name,
      targetPath: t.targetPath,
      type: t.type,
      desc: t.desc || '',
      categoryId: t.categoryId,
      iconKind: !t.icon || t.icon === 'auto' || t.icon.kind === 'auto' ? 'auto'
        : t.icon.kind === 'emoji' ? 'emoji' : 'img',
      emoji: t.icon?.kind === 'emoji' ? t.icon.value : '🧰',
      imgData: t.icon?.kind === 'img' ? t.icon.data : null,
      pinned: !!t.pinned,
      runMode: t.runMode || (t.showWindow === false ? 'log' : 'window'),
      runAsAdmin: !!t.runAsAdmin,
      confirmBeforeRun: !!t.confirmBeforeRun
    }
  } else {
    form.value = defaultForm()
    // 默认选中当前视图的分类
    if (s.view.type === 'cat') form.value.categoryId = s.view.id
    // 拖拽文件预填:自动识别名称 / 类型 / 启动方式
    const dp = s.toolModal.dropPath
    if (dp) {
      s.toolModal.dropPath = null
      form.value.targetPath = dp
      const fileName = dp.split(/[\\/]/).pop()
      form.value.name = fileName.replace(/\.[^.]+$/, '')
      const ext = fileName.toLowerCase().split('.').pop()
      form.value.type = ['bat', 'cmd', 'lnk', 'exe'].includes(ext) ? ext : null
      if (form.value.type === 'lnk') form.value.runMode = 'window'
      else if (ext === 'bat' || ext === 'cmd') form.value.runMode = 'log'
    }
  }
})

/* ---- 文件选择 ---- */
async function pickFile() {
  const p = await qd.pickTool()
  if (!p) return
  form.value.targetPath = p
  pathInvalid.value = false
  // 自动填充名称(去扩展名)与类型
  const fileName = p.split(/[\\/]/).pop()
  if (!isEdit.value || !form.value.name) {
    form.value.name = fileName.replace(/\.[^.]+$/, '')
  }
  const ext = fileName.toLowerCase().split('.').pop()
  form.value.type = ['bat', 'cmd', 'lnk', 'exe'].includes(ext) ? ext : null
  // lnk 的启动方式由快捷方式自身决定
  if (form.value.type === 'lnk') form.value.runMode = 'window'
}

/* ---- 分类选项(含新建) ---- */
const catOptions = computed(() => [
  ...sortedCategories.value.map(c => ({ value: c.id, label: c.name, emoji: c.emoji })),
  { value: null, label: '未分类', emoji: '📥' },
  { value: '__new', label: '新建分类', emoji: '➕' }
])

function onCatChange(v) {
  if (v === '__new') return
  form.value.categoryId = v
}

function onCatCreate(name) {
  const cat = addCategory({ name, emoji: '📁', color: '#4F8CFF' })
  form.value.categoryId = cat.id
  toast(`分类「${name}」已创建`, 'success')
}

/* ---- 图标 ---- */
const showEmojiPicker = ref(false)

async function pickImage() {
  const r = await qd.pickImage()
  if (!r) return
  if (r.error) { toast(r.error, 'error'); return }
  form.value.imgData = r.dataUrl
  form.value.iconKind = 'img'
}

const iconPreview = computed(() => {
  if (form.value.iconKind === 'emoji') return { kind: 'emoji', value: form.value.emoji }
  if (form.value.iconKind === 'img' && form.value.imgData) return { kind: 'img', url: form.value.imgData }
  return { kind: 'letter' }
})

/* ---- 保存 ---- */
async function save() {
  const f = form.value
  // 校验:名称、目标文件必填 + 文件存在性
  nameInvalid.value = !f.name.trim()
  pathInvalid.value = !f.targetPath
  if (nameInvalid.value || pathInvalid.value) {
    toast(f.name.trim() ? '请先选择目标文件' : '请填写名称和目标文件', 'error')
    return
  }
  const exists = await qd.fsExists(f.targetPath)
  if (!exists) {
    pathInvalid.value = true
    toast('目标文件不存在,请检查路径(文件可能已被移动或删除)', 'error')
    return
  }
  if (!f.type) {
    toast('仅支持 .bat / .cmd / .lnk / .exe 文件', 'error')
    return
  }

  const icon = f.iconKind === 'emoji' ? { kind: 'emoji', value: f.emoji }
    : f.iconKind === 'img' && f.imgData ? { kind: 'img', data: f.imgData }
    : 'auto'

  const payload = {
    name: f.name.trim(),
    type: f.type,
    targetPath: f.targetPath,
    desc: f.desc.trim(),
    categoryId: f.categoryId,
    icon,
    pinned: f.pinned,
    runMode: f.runMode,
    runAsAdmin: f.runAsAdmin,
    confirmBeforeRun: f.confirmBeforeRun
  }

  if (isEdit.value) {
    // 先提交启动配置标签页的未保存编辑,再更新基础字段
    launchTabRef.value?.save?.()
    updateTool(s.toolModal.editId, payload)
    toast(`「${payload.name}」已保存`, 'success')
  } else {
    addTool(payload)
    toast(`「${payload.name}」已添加`, 'success')
  }
  persist(true)
  s.toolModal.open = false
}

const isLnk = computed(() => form.value.type === 'lnk')
</script>

<template>
  <Transition name="modal-mask">
    <div v-if="s.toolModal.open" class="mask" @mousedown.self="s.toolModal.open = false">
      <Transition name="modal-box" appear>
        <div class="box scroll-area">
          <h3 class="title">{{ isEdit ? '编辑工具' : '添加工具' }}</h3>

          <!-- v2.0 标签页:基础 / 启动配置 / 环境检查(仅编辑模式) -->
          <div v-if="isEdit" class="tab-bar">
            <button class="tab-item" :class="{ on: tab === 'basic' }" @click="tab = 'basic'">基础</button>
            <button class="tab-item" :class="{ on: tab === 'launch' }" @click="tab = 'launch'">
              启动配置
              <span v-if="editing?.launchConfigs?.length" class="tab-badge">{{ editing.launchConfigs.length }}</span>
            </button>
            <button class="tab-item" :class="{ on: tab === 'envcheck' }" @click="tab = 'envcheck'">
              环境检查
              <span v-if="editing?.checkIds?.length" class="tab-badge">{{ editing.checkIds.length }}</span>
            </button>
          </div>

          <!-- ===== 标签:启动配置 ===== -->
          <LaunchConfigTab v-if="isEdit && tab === 'launch' && editing" ref="launchTabRef" :tool="editing" />

          <!-- ===== 标签:环境检查(v2.1)===== -->
          <EnvCheckTab v-if="isEdit && tab === 'envcheck' && editing" :tool="editing" />

          <!-- ===== 标签:基础 ===== -->
          <template v-if="!isEdit || tab === 'basic'">
          <!-- 名称 -->
          <div class="field">
            <label class="label">名称 <i class="req">*</i></label>
            <input v-model="form.name" class="input" :class="{ invalid: nameInvalid }"
                   placeholder="工具名称" maxlength="30" />
          </div>

          <!-- 目标文件 -->
          <div class="field">
            <label class="label">目标文件 <i class="req">*</i></label>
            <div class="path-row">
              <input v-model="form.targetPath" class="input path" :class="{ invalid: pathInvalid }"
                     placeholder="选择 .bat / .cmd / .lnk / .exe 文件" readonly />
              <button class="btn" @click="pickFile">浏览…</button>
            </div>
            <p v-if="form.type" class="hint">类型:<b>{{ form.type.toUpperCase() }}</b></p>
          </div>

          <!-- 分类 + 置顶 -->
          <div class="field-row">
            <div class="field grow">
              <label class="label">分类</label>
              <CustomSelect :model-value="form.categoryId" :options="catOptions"
                            placeholder="未分类" allow-new
                            @update:modelValue="onCatChange" @create="onCatCreate" />
            </div>
            <div class="field">
              <label class="label">置顶</label>
              <button type="button" class="switch-line" @click="form.pinned = !form.pinned">
                <span class="qd-switch" :class="{ on: form.pinned }"></span>
                <span class="switch-text">{{ form.pinned ? '已置顶' : '未置顶' }}</span>
              </button>
            </div>
          </div>

          <!-- 备注 -->
          <div class="field">
            <label class="label">备注</label>
            <input v-model="form.desc" class="input" placeholder="一句话描述(可选)" maxlength="50" />
          </div>

          <!-- 图标 -->
          <div class="field">
            <label class="label">图标</label>
            <div class="icon-tabs">
              <button class="icon-tab" :class="{ on: form.iconKind === 'auto' }" @click="form.iconKind = 'auto'">
                <ToolIcon :tool="{ id: '__preview', name: form.name || 'A', icon: 'auto', categoryId: form.categoryId }" :size="20" />
                自动
              </button>
              <button class="icon-tab" :class="{ on: form.iconKind === 'emoji' }" @click="form.iconKind = 'emoji'">
                <span class="tab-emoji">{{ form.emoji }}</span>Emoji
              </button>
              <button class="icon-tab" :class="{ on: form.iconKind === 'img' }" @click="form.imgData ? (form.iconKind = 'img') : pickImage()">
                <span class="tab-emoji">🖼</span>图片
              </button>
              <button v-if="form.iconKind === 'emoji'" class="btn btn-ghost emoji-edit" @click="showEmojiPicker = !showEmojiPicker">
                换一个
              </button>
              <button v-if="form.iconKind === 'img'" class="btn btn-ghost emoji-edit" @click="pickImage">换一张</button>
            </div>
            <Transition name="fade">
              <div v-if="form.iconKind === 'emoji' && showEmojiPicker" class="emoji-wrap">
                <EmojiPicker @select="e => { form.emoji = e; showEmojiPicker = false }" />
              </div>
            </Transition>
          </div>

          <!-- 运行选项 -->
          <div class="field">
            <label class="label">运行方式</label>
            <div class="mode-grid" :class="{ disabled: isLnk }">
              <button v-for="m in RUN_MODES" :key="m.value" type="button"
                      class="mode-item" :class="{ on: form.runMode === m.value && !isLnk }"
                      :disabled="isLnk" @click="!isLnk && (form.runMode = m.value)">
                <span class="mode-icon">{{ m.icon }}</span>
                <span class="mode-text">{{ m.label }}<em>{{ m.note }}</em></span>
                <span class="mode-dot"></span>
              </button>
            </div>
            <p v-if="isLnk" class="hint">快捷方式的启动方式由其自身属性决定(图标 / 管理员 / 起始位置)</p>
            <div class="opts" style="margin-top: 8px;">
              <button type="button" class="opt-row" @click="form.runAsAdmin = !form.runAsAdmin">
                <span class="qd-switch" :class="{ on: form.runAsAdmin }"></span>
                <span class="opt-text">以管理员运行 <em class="opt-note">启动时弹出 UAC 确认</em></span>
              </button>
              <button type="button" class="opt-row" @click="form.confirmBeforeRun = !form.confirmBeforeRun">
                <span class="qd-switch" :class="{ on: form.confirmBeforeRun }"></span>
                <span class="opt-text">运行前二次确认 <em class="opt-note">点击工具时先弹出确认框</em></span>
              </button>
            </div>
          </div>

          </template>

          <!-- 操作 -->
          <div class="actions">
            <button class="btn" @click="s.toolModal.open = false">取消</button>
            <button class="btn btn-primary" @click="save">{{ isEdit ? '保存' : '添加' }}</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0;
  z-index: 110;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px) saturate(1.2);
  display: grid; place-items: center;
}
.box {
  width: 500px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border-radius: var(--radius-modal);
  background: var(--bg-elevated);
  backdrop-filter: blur(32px) saturate(1.6);
  box-shadow: var(--shadow-modal), inset 0 0 0 1px var(--divider);
  padding: 22px 24px;
}
.title { font-size: 16px; font-weight: 600; margin-bottom: 14px; }

/* v2.0 标签栏 */
.tab-bar {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  margin-bottom: 16px;
}
.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text-3);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
}
.tab-item:hover { color: var(--text-1); }
.tab-item.on {
  background: var(--bg-elevated);
  color: var(--text-1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.tab-badge {
  font-size: 10px;
  min-width: 16px;
  line-height: 15px;
  text-align: center;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.field { margin-bottom: 14px; }
.field-row { display: flex; gap: 14px; }
.field-row .field { margin-bottom: 14px; }
.grow { flex: 1; }

.label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 6px;
  font-weight: 500;
}
.req { color: var(--danger); font-style: normal; }

.path-row { display: flex; gap: 8px; }
.path { flex: 1; font-size: 12px; }
.hint { margin-top: 6px; font-size: 11.5px; color: var(--text-3); }
.hint b { color: var(--accent); }

.switch-line { display: flex; align-items: center; gap: 8px; height: 34px; }
.switch-text { font-size: 12.5px; color: var(--text-2); }

.icon-tabs { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.icon-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--radius-btn);
  background: var(--bg-input);
  font-size: 12.5px;
  color: var(--text-2);
  transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.icon-tab:hover { background: var(--bg-input-hover); color: var(--text-1); }
.icon-tab:active { transform: scale(0.97); }
.icon-tab.on {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.4);
}
.tab-emoji { font-size: 15px; }
.emoji-edit { height: 34px; }
.emoji-wrap { margin-top: 10px; }

.opts { display: flex; flex-direction: column; gap: 2px; }

/* 运行方式四选一 */
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mode-grid.disabled { opacity: 0.5; pointer-events: none; }
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
.mode-item.on {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px rgba(79, 140, 255, 0.45);
}
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
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-btn);
  text-align: left;
  transition: background var(--dur-fast) var(--ease);
}
.opt-row:hover:not(.disabled) { background: var(--bg-input); }
.opt-row.disabled { opacity: 0.55; cursor: not-allowed; }
.opt-text { font-size: 12.5px; color: var(--text-1); display: flex; flex-direction: column; gap: 1px; }
.opt-note { font-style: normal; font-size: 11px; color: var(--text-3); }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
}
</style>
