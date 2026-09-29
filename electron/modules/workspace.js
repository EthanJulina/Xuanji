// ============================================================
// 玄机 - 工作空间域(主进程模块)
// 职责:workspace: 前缀 IPC —— 工作空间的增删改查与引用完整性
// 关系规则(需求第六节):
//   · Workspace 通过 toolIds 引用工具,不复制数据
//   · 删除工具时自动从所有 workspace 移除引用
//   · 删除 Workspace 只删空间本身,不触碰工具与文件
// 注意:所有写操作走 store 原子保存;时间戳 ISO 格式
// ============================================================
const { ipcMain } = require('electron')
const store = require('../store')
const logger = require('../logger')

// 读取当前配置并校验 workspaces 数组
function readAll() {
  const data = store.load()
  if (!Array.isArray(data.workspaces)) data.workspaces = []
  return data
}

function register() {
  // 全量列表(渲染层启动时同步一次,后续靠事件或主动拉取)
  ipcMain.handle('workspace:list', () => readAll().workspaces)

  // 新建工作空间;payload: { name, emoji, color }
  ipcMain.handle('workspace:create', (_e, payload) => {
    const data = readAll()
    const maxOrder = data.workspaces.reduce((m, w) => Math.max(m, w.sortOrder || 0), 0)
    const ws = {
      id: 'ws-' + require('crypto').randomUUID().slice(0, 8),
      name: String(payload.name || '新工作空间').slice(0, 30),
      emoji: payload.emoji || '🎯',
      color: payload.color || '#4F8CFF',
      toolIds: Array.isArray(payload.toolIds) ? payload.toolIds : [],
      paths: [],                       // 项目目录 [{ id, name, path }]
      vars: {},                        // 空间变量(P1 命令模板渲染用)
      lastOpenedAt: null,
      sortOrder: maxOrder + 1
    }
    data.workspaces.push(ws)
    store.save(data)
    logger.info('workspace', `创建工作空间「${ws.name}」`)
    return ws
  })

  // 更新(重命名/换图标/变量/目录/工具引用等);patch 为部分字段
  ipcMain.handle('workspace:update', (_e, { id, patch }) => {
    const data = readAll()
    const ws = data.workspaces.find(w => w.id === id)
    if (!ws) return { error: '工作空间不存在' }
    // 白名单式合并,防止渲染层塞进多余字段
    const allow = ['name', 'emoji', 'color', 'toolIds', 'paths', 'vars', 'lastOpenedAt', 'sortOrder']
    for (const k of allow) {
      if (k in patch) ws[k] = patch[k]
    }
    store.save(data)
    return { ok: true, workspace: ws }
  })

  // 删除工作空间:仅删除空间本身,工具与文件不受任何影响
  ipcMain.handle('workspace:delete', (_e, id) => {
    const data = readAll()
    const before = data.workspaces.length
    data.workspaces = data.workspaces.filter(w => w.id !== id)
    store.save(data)
    logger.info('workspace', `删除工作空间 ${id}(工具未受影响)`)
    return { ok: true, removed: before - data.workspaces.length }
  })

  // 工具删除后的引用清理:从所有工作空间移除该 toolId
  // (由渲染层 removeTool 后调用;主进程不感知工具删除事件)
  ipcMain.handle('workspace:removeToolRef', (_e, toolId) => {
    const data = readAll()
    let n = 0
    for (const ws of data.workspaces) {
      if (Array.isArray(ws.toolIds) && ws.toolIds.includes(toolId)) {
        ws.toolIds = ws.toolIds.filter(id => id !== toolId)
        n++
      }
    }
    if (n > 0) store.save(data)
    return { ok: true, affected: n }
  })

  // 记录打开时间(进入工作空间视图时调用)
  ipcMain.handle('workspace:touch', (_e, id) => {
    const data = readAll()
    const ws = data.workspaces.find(w => w.id === id)
    if (!ws) return { error: '工作空间不存在' }
    ws.lastOpenedAt = new Date().toISOString().slice(0, 19)
    store.save(data)
    return { ok: true, lastOpenedAt: ws.lastOpenedAt }
  })
}

module.exports = { register }
