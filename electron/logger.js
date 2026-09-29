// ============================================================
// 玄机 - 应用日志(v2.0)
// 策略:追加写入 + 按大小轮转
//   - 追加写 userData/app.log,每次启动写醒目分隔横幅,便于区分
//   - 单份日志上限 5MB(P1 规划),自动轮转 app.log → app.1.log → …
//   - 保留最近 5 份历史
//   - logSafe():排除敏感字段后再写日志,防止凭据进日志
// ============================================================
const fs = require('fs')
const path = require('path')

const MAX_SIZE = 5 * 1024 * 1024   // 单份日志上限:5MB(滚动截断阈值)
const MAX_FILES = 5                // 轮转保留份数:app.1.log ~ app.5.log

// 日志中绝不允许出现的敏感键名(命中即脱敏)
const SENSITIVE_KEYS = ['password', 'passwd', 'secret', 'token', 'auth', 'credential', 'apikey', 'api_key']

let fd = null
let logFile = ''
let logDir = ''
let curSize = 0                    // 当前文件已写字节数(写入时累加,避免频繁 stat)

function ts() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 顺延轮转:删最老 → app.4→app.5 → … → app.log→app.1
function rotate() {
  try {
    const oldest = path.join(logDir, `app.${MAX_FILES}.log`)
    if (fs.existsSync(oldest)) fs.rmSync(oldest)
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = path.join(logDir, `app.${i}.log`)
      if (fs.existsSync(from)) fs.renameSync(from, path.join(logDir, `app.${i + 1}.log`))
    }
    if (fs.existsSync(logFile)) fs.renameSync(logFile, path.join(logDir, 'app.1.log'))
  } catch (_) {}
}

// 打开(或重新打开)日志文件:启动时与每次轮转后调用
function openLog() {
  try { if (fd !== null) fs.closeSync(fd) } catch (_) {}
  fd = null
  try {
    const size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
    if (size >= MAX_SIZE) { rotate(); curSize = 0 }
    else curSize = size
    fd = fs.openSync(logFile, 'a') // 'a' = 追加写,不覆盖历史
  } catch (_) { fd = null }
}

// 应用启动时调用:追加启动横幅
function boot(userDataDir, info = {}) {
  try {
    logDir = userDataDir
    logFile = path.join(logDir, 'app.log')
    openLog()
    write('█'.repeat(26) + '  新的一次启动  ' + '█'.repeat(26))
    write('='.repeat(72))
    write(`玄机 启动  ${ts()}`)
    for (const [k, v] of Object.entries(info)) write(`${k} = ${v}`)
  } catch (_) {
    fd = null
  }
}

function write(line) {
  if (fd === null) return
  try {
    // 运行中达到上限:关闭 → 轮转 → 重开新文件
    if (curSize >= MAX_SIZE) openLog()
    if (fd === null) return
    const buf = Buffer.from(`[${ts()}] ${line}\n`, 'utf-8')
    fs.writeSync(fd, buf)
    curSize += buf.length
  } catch (_) {}
}

const info = (tag, msg) => write(`[INFO ] ${tag} | ${msg}`)
const warn = (tag, msg) => write(`[WARN ] ${tag} | ${msg}`)
const error = (tag, msg) => write(`[ERROR] ${tag} | ${msg}`)
// 通用别名(迁移等模块用)
const log = (msg) => write(`[INFO ] migrate | ${msg}`)

// 敏感对象脱敏后写入(值替换为 ***);供排查配置问题用
function logSafe(tag, obj) {
  try {
    const safe = JSON.parse(JSON.stringify(obj || {}, (k, v) => {
      if (typeof k === 'string' && SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s))) {
        return '***'
      }
      return v
    }))
    write(`[INFO ] ${tag} | ${JSON.stringify(safe)}`)
  } catch (_) {}
}

// 退出时调用:写退出原因并关闭句柄
function shutdown(reason) {
  write(`--- 应用退出:${reason} ---`)
  try { if (fd !== null) fs.closeSync(fd) } catch (_) {}
  fd = null
}

function getLogFile() { return logFile }
function getLogDir() { return logDir }

module.exports = { boot, info, warn, error, log, logSafe, shutdown, getLogFile, getLogDir, MAX_SIZE, MAX_FILES }
