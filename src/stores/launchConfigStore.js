// ============================================================
// 玄机 - 启动配置域 store(渲染层)
// 职责:launchConfig 的 CRUD / active 切换 / 回落解析(展示用)
// 兼容回落(需求 7.2):
//   运行时优先取 active 配置;某字段为空或配置缺失时
//   回落到工具顶层旧字段 —— 由主进程 launcher:run 权威执行,
//   这里只做展示层解析(名称徽标等),不重复实现
// ============================================================
import { reactive } from 'vue'
import { s, toolById, persist, toast } from '../composables/store'

export const lc = reactive({
  editingToolId: null       // 启动配置标签页正在编辑的工具 id
})

// 工具的有效 launchConfig(渲染层展示用;与主进程回落规则一致)
export function effectiveConfig(tool) {
  const configs = Array.isArray(tool.launchConfigs) ? tool.launchConfigs : []
  return configs.find(c => c.id === tool.activeLaunchConfigId) || configs[0] || null
}

// 展示:当前默认配置名(准备面板 / 卡片副标题)
export function activeLaunchConfigName(tool) {
  const cfg = effectiveConfig(tool)
  if (!cfg) return '默认启动(旧版字段)'
  const mode = { window: '正常窗口', hidden: '隐藏窗口', log: '日志模式', service: '后台服务' }[cfg.runMode] || ''
  return `${cfg.name}${mode ? ' · ' + mode : ''}${cfg.runAsAdmin ? ' · 管理员' : ''}`
}

// 全部配置(含「默认回落」伪条目,当工具没有任何配置时)
export function listConfigs(tool) {
  return Array.isArray(tool.launchConfigs) ? tool.launchConfigs : []
}

/* ---------------- CRUD(直接改工具对象,走统一 persist) ---------------- */
export function createLaunchConfig(tool, preset = {}) {
  const cfg = {
    id: 'lc-' + crypto.randomUUID().slice(0, 8),
    name: preset.name || `配置 ${listConfigs(tool).length + 1}`,
    args: preset.args || '',
    cwd: preset.cwd || '',
    env: { ...(preset.env || {}) },
    runAsAdmin: preset.runAsAdmin !== undefined ? !!preset.runAsAdmin : !!tool.runAsAdmin,
    runMode: preset.runMode || tool.runMode || 'window',
    showWindow: preset.showWindow !== undefined ? preset.showWindow : (preset.runMode || tool.runMode || 'window') === 'window',
    captureLog: preset.captureLog !== undefined ? preset.captureLog : ['hidden', 'log'].includes(preset.runMode || tool.runMode || 'window')
  }
  if (!Array.isArray(tool.launchConfigs)) tool.launchConfigs = []
  tool.launchConfigs.push(cfg)
  return cfg
}

// 复制配置(名称加「副本」)
export function duplicateLaunchConfig(tool, configId) {
  const src = tool.launchConfigs?.find(c => c.id === configId)
  if (!src) return null
  return createLaunchConfig(tool, {
    ...JSON.parse(JSON.stringify(src)),
    name: src.name + ' 副本'
  })
}

export function removeLaunchConfig(tool, configId) {
  if (!Array.isArray(tool.launchConfigs)) return
  tool.launchConfigs = tool.launchConfigs.filter(c => c.id !== configId)
  // active 被删:回落到第一条;全部删光 = 纯旧字段模式(行为与 v1 一致)
  if (tool.activeLaunchConfigId === configId) {
    tool.activeLaunchConfigId = tool.launchConfigs[0]?.id || null
  }
}

export function setActiveLaunchConfig(tool, configId) {
  tool.activeLaunchConfigId = configId
  persist()
}

// 保存整组配置(编辑标签页提交用)
export function saveLaunchConfigs(tool, configs, activeId) {
  tool.launchConfigs = configs
  tool.activeLaunchConfigId = activeId || configs[0]?.id || null
  persist()
}
