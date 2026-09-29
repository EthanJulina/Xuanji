// ============================================================
// 玄机 - 环境健康检查域 v2.1(health: 前缀)
// 三类检测模板(exec / port / file):
//   exec  运行命令,expectRegex 命中输出(或退出码 0)即通过
//   port  TCP 连通性:连上 = 通过
//   file  路径存在即通过
// 缓存:checkId → { ok, message, at },TTL = settings.healthCheck.cacheTtlSec
// 供启动链路(launcher.beforeLaunch)与手动检查共用
// ============================================================
const { ipcMain } = require('electron')
const { spawn } = require('child_process')
const net = require('net')
const fs = require('fs')
const store = require('../store')
const logger = require('../logger')

// 检测结果缓存:checkId → { ok, message, fixTip, at }
const cache = new Map()

function loadChecks() {
  const data = store.load()
  return Array.isArray(data.checks) ? data.checks : []
}

function loadHealthSettings() {
  const s = (store.load().settings && store.load().settings.healthCheck) || {}
  return { cacheTtlSec: Number(s.cacheTtlSec) || 300, blockOnFail: s.blockOnFail !== false }
}

// 设置变更后失效缓存
function invalidateCache() { cache.clear() }

/* ---------------- 三类检测 ---------------- */
function runExecCheck(check) {
  return new Promise((resolve) => {
    const timeout = Math.min(Number(check.timeoutMs) || 8000, 30000)
    let child
    try {
      child = spawn('cmd.exe', ['/c', String(check.command || '')], { windowsHide: true })
    } catch (e) {
      resolve({ ok: false, message: '启动检测命令失败:' + e.message })
      return
    }
    let out = ''
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch (_) {}
      resolve({ ok: false, message: `检测超时(>${timeout}ms):${check.command}` })
    }, timeout)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('exit', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const exp = String(check.expectRegex || '').trim()
      if (exp) {
        try {
          const re = new RegExp(exp, 'i')
          resolve({ ok: re.test(out), message: re.test(out) ? `输出命中 /${exp}/` : `输出未命中 /${exp}/(退出码 ${code})` })
        } catch (_) {
          resolve({ ok: false, message: `expectRegex 非法:${exp}` })
        }
      } else {
        resolve({ ok: code === 0, message: `退出码 ${code}` })
      }
    })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, message: e.message })
    })
  })
}

function runPortCheck(check) {
  return new Promise((resolve) => {
    const port = Number(check.port)
    if (!port || port < 1 || port > 65535) {
      resolve({ ok: false, message: `端口非法:${check.port}` })
      return
    }
    const host = String(check.host || '127.0.0.1')
    const socket = new net.Socket()
    let done = false
    const finish = (ok, message) => {
      if (done) return
      done = true
      socket.destroy()
      resolve({ ok, message })
    }
    socket.setTimeout(3000)
    socket.once('connect', () => finish(true, `${host}:${port} 可达`))
    socket.once('timeout', () => finish(false, `连接超时(3s):${host}:${port}`))
    socket.once('error', (e) => finish(false, `${host}:${port} 不可达(${e.code || e.message})`))
    try { socket.connect(port, host) } catch (e) { finish(false, e.message) }
  })
}

function runFileCheck(check) {
  const p = String(check.path || '')
  if (!p) return Promise.resolve({ ok: false, message: '未配置检测路径' })
  const ok = fs.existsSync(p)
  return Promise.resolve({ ok, message: ok ? `路径存在:${p}` : `路径不存在:${p}` })
}

async function runOne(check) {
  const t0 = Date.now()
  let r
  if (check.type === 'exec') r = await runExecCheck(check)
  else if (check.type === 'port') r = await runPortCheck(check)
  else if (check.type === 'file') r = await runFileCheck(check)
  else r = { ok: false, message: `未知检测类型:${check.type}` }
  return { ...r, durationMs: Date.now() - t0 }
}

/* ---------------- 带缓存的批量检查 ----------------
 * checkIds: 要跑的模板 id 列表;force: 跳过缓存
 * 返回 [{ checkId, name, type, ok, message, fixTip, durationMs, cached }]
 */
async function runChecks(checkIds, force = false) {
  const all = loadChecks()
  const { cacheTtlSec } = loadHealthSettings()
  const ids = (checkIds || []).filter(Boolean)
  const targets = ids.length ? all.filter(c => ids.includes(c.id)) : all
  const out = []
  for (const c of targets) {
    const hit = cache.get(c.id)
    if (!force && hit && Date.now() - hit.at < cacheTtlSec * 1000) {
      out.push({ checkId: c.id, name: c.name, type: c.type, ok: hit.ok, message: hit.message, fixTip: c.fixTip || '', durationMs: 0, cached: true })
      continue
    }
    const r = await runOne(c)
    cache.set(c.id, { ok: r.ok, message: r.message, at: Date.now() })
    out.push({ checkId: c.id, name: c.name, type: c.type, ok: r.ok, message: r.message, fixTip: c.fixTip || '', durationMs: r.durationMs, cached: false })
  }
  return out
}

function register() {
  // 手动检查:payload { checkIds?, force? }
  ipcMain.handle('health:run', (_e, payload) => {
    const ids = payload && Array.isArray(payload.checkIds) ? payload.checkIds : []
    const force = !!(payload && payload.force)
    return runChecks(ids, force)
  })

  // 模板 CRUD(渲染层设置页 / ToolModal 挂载管理)
  ipcMain.handle('health:checks', () => loadChecks())
  ipcMain.handle('health:create', (_e, payload) => {
    const data = store.load()
    if (!Array.isArray(data.checks)) data.checks = []
    const chk = {
      id: 'chk-' + require('crypto').randomUUID().slice(0, 8),
      name: String(payload.name || '新检查').slice(0, 40),
      type: ['exec', 'port', 'file'].includes(payload.type) ? payload.type : 'exec',
      command: String(payload.command || ''),
      expectRegex: String(payload.expectRegex || ''),
      timeoutMs: Math.min(30000, Math.max(1000, Number(payload.timeoutMs) || 8000)),
      host: String(payload.host || '127.0.0.1'),
      port: Number(payload.port) || 0,
      path: String(payload.path || ''),
      fixTip: String(payload.fixTip || '')
    }
    data.checks.push(chk)
    store.save(data)
    logger.info('health', `创建检查模板「${chk.name}」(${chk.type})`)
    return chk
  })
  ipcMain.handle('health:update', (_e, { id, patch }) => {
    const data = store.load()
    const chk = (data.checks || []).find(c => c.id === id)
    if (!chk) return { error: '检查模板不存在' }
    const allow = ['name', 'type', 'command', 'expectRegex', 'timeoutMs', 'host', 'port', 'path', 'fixTip']
    for (const k of allow) {
      if (k in patch) chk[k] = patch[k]
    }
    store.save(data)
    invalidateCache()
    return { ok: true, check: chk }
  })
  ipcMain.handle('health:delete', (_e, id) => {
    const data = store.load()
    const before = (data.checks || []).length
    data.checks = (data.checks || []).filter(c => c.id !== id)
    // 引用完整性:从所有工具的 checkIds 移除
    for (const t of data.tools || []) {
      if (Array.isArray(t.checkIds)) t.checkIds = t.checkIds.filter(x => x !== id)
    }
    store.save(data)
    invalidateCache()
    logger.info('health', `删除检查模板 ${id}(${before} → ${data.checks.length})`)
    return { ok: true }
  })
}

module.exports = { register, runChecks, invalidateCache, loadHealthSettings }
