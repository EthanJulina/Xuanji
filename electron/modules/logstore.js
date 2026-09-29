// ============================================================
// 玄机 - 日志中心 v2.1(log: 前缀)
// jsonl 落盘:dataDir/logs/<toolId>.jsonl,每行一个 JSON:
//   { "t": "2026-03-01T12:00:00.000Z", "lvl": "error", "text": "..." }
// 等级判定:runner 显式等级保留;info 级按 settings.log 的
//   errorPatterns / warnPatterns 正则重判(优先 error)。
// 轮转:单文件超 maxFileSizeMB → 改名 <toolId>.1.jsonl(仅保留 1 代)
// 过期:retentionDays 天前的日志文件启动时清理 + 每 6h 巡检
// ============================================================
const { ipcMain, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { shell } = require('electron')
const logger = require('../logger')

const logsDir = path.join(app.getPath('userData'), 'logs')
const READ_TAIL_LIMIT = 10000   // 单工具单次最多读回 1 万行(渲染层虚拟滚动)

// 运行时状态
let cfg = { errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 }
let reErr = []
let reWarn = []
// meta 缓存:toolId → { lines, bytes, errors, warns, lastAt } ;首调 listTools 时惰性扫盘
const meta = new Map()
let metaScanned = false

/* ---------------- 设置注入(main.js 启动 + settings:sync 时调用) ---------------- */
function configure(logSettings) {
  if (!logSettings || typeof logSettings !== 'object') return
  cfg = { ...cfg, ...logSettings }
  const compile = (arr) => (Array.isArray(arr) ? arr : [])
    .map(p => { try { return new RegExp(p, 'i') } catch (_) { return null } })
    .filter(Boolean)
  reErr = compile(cfg.errorPatterns)
  reWarn = compile(cfg.warnPatterns)
}

/* ---------------- 等级判定 ---------------- */
// 返回 'info' | 'success' | 'warning' | 'error'
function classify(text, level) {
  if (level === 'error' || level === 'warning' || level === 'success') return level
  // info 级:输出内容按模式重判(error 优先)
  if (reErr.some(re => re.test(text))) return 'error'
  if (reWarn.some(re => re.test(text))) return 'warning'
  return 'info'
}

/* ---------------- 文件路径 ---------------- */
const filePath = (toolId) => path.join(logsDir, `${toolId}.jsonl`)
const filePathRotated = (toolId) => path.join(logsDir, `${toolId}.1.jsonl`)

/* ---------------- 落盘 ---------------- */
function append(toolId, text, level = 'info') {
  const lvl = classify(text, level)
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    // 轮转检查:超限先把当前文件让位给 .1(顶掉旧历史)
    rollIfNeeded(toolId)
    const line = JSON.stringify({ t: new Date().toISOString(), lvl, text }) + '\n'
    fs.appendFileSync(filePath(toolId), line, 'utf-8')
    // meta 增量
    const m = meta.get(toolId) || { lines: 0, bytes: 0, errors: 0, warns: 0, lastAt: null }
    m.lines += 1
    m.bytes += Buffer.byteLength(line)
    if (lvl === 'error') m.errors += 1
    else if (lvl === 'warning') m.warns += 1
    m.lastAt = Date.now()
    meta.set(toolId, m)
  } catch (e) {
    logger.warn('logstore', `写入日志失败(${toolId}):${e.message}`)
  }
  return lvl
}

function rollIfNeeded(toolId) {
  const f = filePath(toolId)
  try {
    const max = (cfg.maxFileSizeMB || 5) * 1024 * 1024
    if (!fs.existsSync(f) || fs.statSync(f).size < max) return
    const rot = filePathRotated(toolId)
    if (fs.existsSync(rot)) fs.rmSync(rot, { force: true })
    fs.renameSync(f, rot)
    // 轮转后精确重算 meta(低频事件,读盘代价可接受)
    meta.set(toolId, statFile(toolId))
    logger.info('logstore', `日志轮转:${toolId}.jsonl → ${toolId}.1.jsonl`)
  } catch (_) {}
}

/* ---------------- 读取 ---------------- */
// 读单个文件最后 N 行(倒序回扫,避免整读大文件)
function tailLines(file, n) {
  if (!fs.existsSync(file)) return []
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const start = Math.max(0, lines.length - n)
    return lines.slice(start).map(parseLine).filter(Boolean)
  } catch (_) { return [] }
}

function parseLine(line) {
  try {
    const o = JSON.parse(line)
    if (typeof o.text !== 'string') return null
    return { t: o.t || '', lvl: o.lvl || 'info', text: o.text }
  } catch (_) { return null }
}

// 读某工具日志:先拼 .1 历史,再接当前文件,合计 tail 上限(取最后 tail 行)
function read(toolId, tail = READ_TAIL_LIMIT) {
  const rot = tailLines(filePathRotated(toolId), tail)
  const cur = tailLines(filePath(toolId), Math.max(0, tail - rot.length))
  return [...rot, ...cur]
}

/* ---------------- 全量导出文本(渲染层保存用) ---------------- */
function exportText(toolId) {
  const out = []
  for (const f of [filePathRotated(toolId), filePath(toolId)]) {
    if (!fs.existsSync(f)) continue
    try {
      for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        const o = parseLine(line)
        if (!o) continue
        const time = o.t ? o.t.replace('T', ' ').slice(0, 19) : ''
        out.push(`[${time}] [${o.lvl.toUpperCase()}] ${o.text}`)
      }
    } catch (_) {}
  }
  return out
}

/* ---------------- 清空 ---------------- */
function clear(toolId) {
  try {
    for (const f of [filePathRotated(toolId), filePath(toolId)]) {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true })
    }
  } catch (_) {}
  meta.delete(toolId)
}

/* ---------------- 列表(日志中心左栏) ---------------- */
// 惰性首扫:读目录内全部 .jsonl 统计 meta
function scanIfNeeded() {
  if (metaScanned) return
  metaScanned = true
  try {
    if (!fs.existsSync(logsDir)) return
    for (const name of fs.readdirSync(logsDir)) {
      const m = name.match(/^(.+)\.jsonl$/)
      if (!m) continue
      const toolId = m[1]
      if (!meta.has(toolId)) {
        meta.set(toolId, statFile(toolId))
      }
    }
  } catch (_) {}
}

// 统计某工具全部日志(.1 + 当前)
function statFile(toolId) {
  const st = { lines: 0, bytes: 0, errors: 0, warns: 0, lastAt: 0 }
  for (const f of [filePathRotated(toolId), filePath(toolId)]) {
    if (!fs.existsSync(f)) continue
    try {
      const raw = fs.readFileSync(f, 'utf-8')
      st.bytes += Buffer.byteLength(raw)
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const o = parseLine(line)
        if (!o) continue
        st.lines += 1
        if (o.lvl === 'error') st.errors += 1
        else if (o.lvl === 'warning') st.warns += 1
        if (o.t) {
          const ts = Date.parse(o.t)
          if (ts > st.lastAt) st.lastAt = ts
        }
      }
    } catch (_) {}
  }
  return st
}

function listTools() {
  scanIfNeeded()
  const out = []
  for (const [toolId, m] of meta) {
    // 文件已被清空/删除的条目跳过
    if (!fs.existsSync(filePath(toolId)) && !fs.existsSync(filePathRotated(toolId))) continue
    out.push({ toolId, lines: m.lines, bytes: m.bytes, errors: m.errors, warns: m.warns, lastAt: m.lastAt })
  }
  out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
  return out
}

/* ---------------- 过期清理 ---------------- */
function maintenance() {
  const days = Number(cfg.retentionDays) || 14
  const cutoff = Date.now() - days * 24 * 3600 * 1000
  let removed = 0
  try {
    if (!fs.existsSync(logsDir)) return removed
    for (const name of fs.readdirSync(logsDir)) {
      const f = path.join(logsDir, name)
      try {
        if (fs.statSync(f).mtimeMs < cutoff) { fs.rmSync(f, { force: true }); removed++ }
      } catch (_) {}
    }
    // 清理后 meta 重置(下次 list 重扫)
    if (removed > 0) { meta.clear(); metaScanned = false }
    if (removed > 0) logger.info('logstore', `过期清理:删除 ${removed} 个日志文件(>${days} 天)`)
  } catch (_) {}
  return removed
}

/* ---------------- IPC 注册 ---------------- */
function register() {
  ipcMain.handle('log:list', () => listTools())
  ipcMain.handle('log:read', (_e, toolId, tail) => read(String(toolId), Math.min(Number(tail) || READ_TAIL_LIMIT, READ_TAIL_LIMIT)))
  ipcMain.handle('log:clear', (_e, toolId) => { clear(String(toolId)); return { ok: true } })
  ipcMain.handle('log:export', (_e, toolId) => exportText(String(toolId)))
  ipcMain.handle('log:openDir', () => { fs.mkdirSync(logsDir, { recursive: true }); shell.openPath(logsDir); return true })
}

// 应用关闭前清定时器用不着——定时器随进程结束;导出供测试
module.exports = {
  logsDir, configure, classify, append, read, listTools, clear, exportText, maintenance, register,
  _startMaintenanceTimer() {
    setInterval(() => maintenance(), 6 * 3600 * 1000)
    setTimeout(() => maintenance(), 10_000)   // 启动后 10s 首巡
  }
}
