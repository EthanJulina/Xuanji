// ============================================================
// 玄机 - preload
// 通过 contextBridge 向渲染层暴露最小、安全的本地能力接口 window.qd
// ============================================================
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('qd', {
  // 窗口控制
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  winSetMaterial: (m) => ipcRenderer.invoke('win:setMaterial', m),
  winClose: () => ipcRenderer.invoke('win:close'),
  appQuit: () => ipcRenderer.invoke('app:quit'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openLogFile: () => ipcRenderer.invoke('logger:open'),
  onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
  // 全局快捷键 Ctrl+Space:主进程呼出窗口后通知渲染层打开命令面板
  onPaletteToggle: (cb) => ipcRenderer.on('palette:toggle', () => cb()),

  // 数据
  storeLoad: () => ipcRenderer.invoke('store:load'),
  storeSave: (data) => ipcRenderer.invoke('store:save', data),
  fsExists: (p) => ipcRenderer.invoke('fs:exists', p),
  pathInfo: (p) => ipcRenderer.invoke('fs:pathInfo', p),

  // 选择器
  pickTool: () => ipcRenderer.invoke('dialog:pickTool'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),

  // 图标 / 运行
  getIcon: (toolId, targetPath) => ipcRenderer.invoke('icon:get', toolId, targetPath),
  removeIcon: (toolId) => ipcRenderer.invoke('icon:remove', toolId),
  runTool: (tool) => ipcRenderer.invoke('runner:run', tool),
  procList: () => ipcRenderer.invoke('runner:list'),
  toolLogs: (toolId) => ipcRenderer.invoke('runner:logs', toolId),
  clearLogs: (toolId) => ipcRenderer.invoke('runner:clearLogs', toolId),
  killPid: (pid) => ipcRenderer.invoke('runner:kill', pid),
  killByTool: (toolId) => ipcRenderer.invoke('runner:killByTool', toolId),
  // 事件订阅:返回退订函数(此前直接返回 ipcRenderer.on 的返回值,
  // 组件卸载时 offLog?.() 必然 TypeError,监听器永远注销不掉 → 越用越卡)
  onProcChanged: (cb) => {
    const h = (_e, list) => cb(list)
    ipcRenderer.on('runner:changed', h)
    return () => ipcRenderer.removeListener('runner:changed', h)
  },
  onRunnerLog: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('runner:log', h)
    return () => ipcRenderer.removeListener('runner:log', h)
  },
  onRunnerAlert: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('runner:alert', h)
    return () => ipcRenderer.removeListener('runner:alert', h)
  },
  // 全局快捷键注册结果推送(设置页保存后反馈是否生效)
  onShortcutResult: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('shortcut:result', h)
    return () => ipcRenderer.removeListener('shortcut:result', h)
  },

  // 日志面板辅助
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  saveLogsAs: (toolName, lines) => ipcRenderer.invoke('dialog:saveLogs', { toolName, lines }),

  // 预设工具包
  importPreset: () => ipcRenderer.invoke('preset:import'),

  // Shell / 配置
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  exportConfig: (data) => ipcRenderer.invoke('config:export', data),
  importConfig: () => ipcRenderer.invoke('config:import'),
  syncSettings: (s) => ipcRenderer.invoke('settings:sync', s),

  // ---- v2.0 工作空间域(workspace: 前缀)----
  wsList: () => ipcRenderer.invoke('workspace:list'),
  wsCreate: (payload) => ipcRenderer.invoke('workspace:create', payload),
  wsUpdate: (id, patch) => ipcRenderer.invoke('workspace:update', { id, patch }),
  wsDelete: (id) => ipcRenderer.invoke('workspace:delete', id),
  wsRemoveToolRef: (toolId) => ipcRenderer.invoke('workspace:removeToolRef', toolId),
  wsTouch: (id) => ipcRenderer.invoke('workspace:touch', id),

  // ---- v2.0 启动器域(launcher: 前缀;以指定/默认启动配置运行)----
  launcherRun: (payload) => ipcRenderer.invoke('launcher:run', payload),
  launcherResolve: (tool, configId) => ipcRenderer.invoke('launcher:resolve', { tool, configId }),

  // ---- v2.0 敏感字段域(secret: 前缀;safeStorage/DPAPI)----
  secretEncrypt: (text) => ipcRenderer.invoke('secret:encrypt', text),
  secretDecrypt: (box) => ipcRenderer.invoke('secret:decrypt', box),
  secretAvailable: () => ipcRenderer.invoke('secret:available'),

  // ---- v2.0 目录选择器(工作空间项目目录用)----
  pickDirectory: async () => {
    const r = await ipcRenderer.invoke('dialog:pickDir')
    return r
  },

  // ---- v2.1 日志中心(log: 前缀)----
  logList: () => ipcRenderer.invoke('log:list'),
  logRead: (toolId, tail) => ipcRenderer.invoke('log:read', toolId, tail),
  logClear: (toolId) => ipcRenderer.invoke('log:clear', toolId),
  logExport: (toolId) => ipcRenderer.invoke('log:export', toolId),
  logOpenDir: () => ipcRenderer.invoke('log:openDir'),

  // ---- v2.1 命令库(command: 前缀)----
  commandList: () => ipcRenderer.invoke('command:list'),
  commandCreate: (payload) => ipcRenderer.invoke('command:create', payload),
  commandUpdate: (id, patch) => ipcRenderer.invoke('command:update', { id, patch }),
  commandDelete: (id) => ipcRenderer.invoke('command:delete', id),
  commandRun: (payload) => ipcRenderer.invoke('command:run', payload),

  // ---- v2.1 资源中心 ----
  resourcePreview: (p) => ipcRenderer.invoke('resource:preview', p),
  resourceOpen: (p) => ipcRenderer.invoke('resource:open', p),

  // ---- v2.1 环境健康检查(health: 前缀)----
  healthRun: (payload) => ipcRenderer.invoke('health:run', payload),
  healthChecks: () => ipcRenderer.invoke('health:checks'),
  healthCreate: (payload) => ipcRenderer.invoke('health:create', payload),
  healthUpdate: (id, patch) => ipcRenderer.invoke('health:update', { id, patch }),
  healthDelete: (id) => ipcRenderer.invoke('health:delete', id)
})
