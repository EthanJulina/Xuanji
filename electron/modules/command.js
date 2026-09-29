// ============================================================
// 玄机 - 命令库域 v2.1(command: 前缀)
// 职责:commands 实体 CRUD + 命令运行(隐藏 cmd /c,输出进日志中心)
// 数据:tools.json 的 commands[];变量渲染在渲染层完成
//       (workspace > globalVars > ask 优先级),主进程只收渲染结果
// 安全:运行前由渲染层强制过危险命令确认;主进程兜底再扫一遍
//       dangerPatterns,命中且未经确认的调用直接拒绝
// ============================================================
const { ipcMain } = require('electron')
const store = require('../store')
const logger = require('../logger')
const runner = require('../runner')

function readAll() {
  const data = store.load()
  if (!Array.isArray(data.commands)) data.commands = []
  return data
}

// 危险命令兜底检测:渲染后命令命中任一 pattern → 拒绝未确认运行
function isDangerous(rendered) {
  const pats = (store.load().settings?.run?.dangerPatterns) || []
  for (const p of pats) {
    try { if (new RegExp(p, 'i').test(rendered)) return true } catch (_) {}
  }
  return false
}

function register() {
  // 全量列表
  ipcMain.handle('command:list', () => readAll().commands)

  // 新建;payload: { name, emoji, desc, template, tags }
  ipcMain.handle('command:create', (_e, payload) => {
    const data = readAll()
    const cmd = {
      id: 'cmd-' + require('crypto').randomUUID().slice(0, 8),
      name: String(payload.name || '新命令').slice(0, 60),
      emoji: payload.emoji || '⌨️',
      desc: String(payload.desc || ''),
      template: String(payload.template || ''),
      tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 10) : [],
      favorite: false,
      varMemory: {},          // ask 变量记忆:key → 上次填写值
      runCount: 0,
      lastRunAt: null,
      createdAt: new Date().toISOString().slice(0, 19)
    }
    data.commands.push(cmd)
    store.save(data)
    logger.info('command', `创建命令「${cmd.name}」`)
    return cmd
  })

  // 更新;patch 为部分字段(含 varMemory 持久化)
  ipcMain.handle('command:update', (_e, { id, patch }) => {
    const data = readAll()
    const cmd = data.commands.find(c => c.id === id)
    if (!cmd) return { error: '命令不存在' }
    const allow = ['name', 'emoji', 'desc', 'template', 'tags', 'favorite', 'varMemory', 'runCount', 'lastRunAt']
    for (const k of allow) {
      if (k in patch) cmd[k] = patch[k]
    }
    store.save(data)
    return { ok: true, command: cmd }
  })

  // 删除
  ipcMain.handle('command:delete', (_e, id) => {
    const data = readAll()
    const before = data.commands.length
    data.commands = data.commands.filter(c => c.id !== id)
    store.save(data)
    logger.info('command', `删除命令 ${id}(before ${before} → after ${data.commands.length})`)
    return { ok: true }
  })

  // 运行(渲染层已渲染变量、已过 ask 表单与危险确认)
  // payload: { id, name, rendered, cwd, confirmedDanger }
  ipcMain.handle('command:run', (_e, payload) => {
    const { id, name, rendered, cwd, confirmedDanger } = payload || {}
    if (!rendered || typeof rendered !== 'string') return { ok: false, error: '命令内容为空' }
    if (isDangerous(rendered) && !confirmedDanger) {
      logger.warn('command', `拒绝未确认的危险命令「${name}」`)
      return { ok: false, error: 'danger-blocked', message: '命令命中危险规则且未经确认,已阻止运行' }
    }
    const cwdSafe = (typeof cwd === 'string' && cwd.trim()) ? cwd.trim() : undefined
    logger.info('command', `运行命令「${name}」rendered=${rendered.slice(0, 120)}`)
    const r = runner.runCmd(id, name || '命令', rendered, cwdSafe)
    // 更新统计(独立读写,不阻塞返回)
    try {
      const data = readAll()
      const cmd = data.commands.find(c => c.id === id)
      if (cmd) {
        cmd.runCount = (cmd.runCount || 0) + 1
        cmd.lastRunAt = new Date().toISOString().slice(0, 19)
        store.save(data)
      }
    } catch (_) {}
    return r
  })
}

module.exports = { register }
