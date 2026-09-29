// ============================================================
// 玄机 - 进程层
// 启动模式(runMode):
//   window  正常窗口   —— bat: start 独立控制台;exe: 直接启动
//   hidden  隐藏窗口   —— 后台运行,输出捕获到日志面板(不自动打开)
//   log     日志模式   —— 同隐藏,且运行后自动打开日志面板实时查看
//   service 后台服务   —— detached 独立常驻,不追踪、退出玄机不结束
// 日志等级:info / success / warn / error;输出自动扫描异常并给出修复建议
// 进程指标:每 3s 采集运行中进程的 CPU / 内存,推送给渲染层
// ============================================================
const { ipcMain, app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { shell } = require('electron')

const running = new Map()   // pid → { pid, toolId, name, type, startedAt, process, cpu, ram }
const logs = new Map()      // toolId → [{ time, text, level }]
const maxLogsPerTool = 300
const logger = require('./logger') // 应用启动日志(追加+轮转)
// v2.1:日志中心落盘(jsonl + 等级重判 + 轮转/过期)
const logstore = require('./modules/logstore')

// 每个工具的异常提示去重(60s 内同一建议只弹一次)
const lastAlert = new Map() // toolId → { hint, at }

function now() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/* ---------------- 异常识别:常见错误 → 修复建议 ---------------- */
const ERROR_PATTERNS = [
  { re: /is not recognized|不是内部或外部命令|无法识别/i, hint: '命令未找到:请检查系统 PATH 环境变量' },
  { re: /could not find or load main class|java.*not found|找不到.*java|JAVA_HOME/i, hint: 'Java 未找到:请检查 JAVA_HOME 环境变量' },
  { re: /python.*not found|找不到.*python|No module named/i, hint: 'Python 异常:请检查 PATH 或 pip 依赖' },
  { re: /EADDRINUSE|address already in use|端口.*占用|bind.*failed/i, hint: '端口被占用:可结束占用进程或更换端口' },
  { re: /access is denied|拒绝访问|权限不足| privileges /i, hint: '权限不足:可尝试以管理员运行' },
  { re: /cannot find the (file|path)|系统找不到指定的(文件|路径)/i, hint: '路径无效:目标文件可能已被移动或删除' },
  { re: /Exception|Traceback|FATAL|Segmentation fault/i, hint: '检测到异常输出,请查看日志面板' }
]

// 扫描一行输出;首次命中(或距上次超过 60s)时给出建议并推送 toast
// 返回建议文本;已提示过时返回 null(该行仅标红,不再刷建议行)
function scanErrors(toolId, text) {
  for (const p of ERROR_PATTERNS) {
    if (p.re.test(text)) {
      const prev = lastAlert.get(toolId)
      if (prev && prev.hint === p.hint && Date.now() - prev.at < 60_000) return null
      lastAlert.set(toolId, { hint: p.hint, at: Date.now() })
      for (const w of require('./main-bridge').windows()) {
        w.webContents.send('runner:alert', { toolId, hint: p.hint })
      }
      return p.hint
    }
  }
  return null
}

function pushLog(toolId, text, level = 'info', fromScanner = false) {
  if (!logs.has(toolId)) logs.set(toolId, [])
  const arr = logs.get(toolId)
  // 输出内容自动识别异常:提升为 error 并追加修复建议(fromScanner 防止建议行自身再触发扫描)
  let hint = null
  if (!fromScanner && level !== 'success' && text && !text.startsWith('[')) {
    hint = scanErrors(toolId, text)
    if (hint) level = 'error'
  }
  // v2.1:落盘日志中心;info 级按 errorPatterns/warnPatterns 重判(如 stderr 行升 warning)
  const finalLevel = logstore.append(toolId, text, level)
  arr.push({ time: now(), text, level: finalLevel })
  if (arr.length > maxLogsPerTool) arr.splice(0, arr.length - maxLogsPerTool)
  for (const w of require('./main-bridge').windows()) {
    w.webContents.send('runner:log', { toolId, entry: { time: now(), text, level: finalLevel } })
  }
  if (hint) pushLog(toolId, `💡 ${hint}`, 'warning', true)
}

// 类型识别:按扩展名
function detectType(p) {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.bat' || ext === '.cmd') return ext.slice(1)
  if (ext === '.lnk') return 'lnk'
  if (ext === '.exe') return 'exe'
  return null
}

function notifyChanged() {
  for (const w of require('./main-bridge').windows()) {
    w.webContents.send('runner:changed', list())
  }
}

// runMode 兼容:老数据只有 showWindow 布尔
function resolveMode(tool) {
  if (tool.runMode) return tool.runMode
  return tool.showWindow === false ? 'log' : 'window'
}

// 管理员启动:ShellExecute 'runas' 动词(安全红线:禁止 cmd 提权 hack)
// 通过 PowerShell 的 Shell.Application COM 调用 ShellExecute,
// 与右键「以管理员身份运行」完全一致,带参数与工作目录
// toolId 用于异步回调时写运行日志
function runAsAdmin(toolId, target, args, cwd) {
  const q = (s) => String(s).replace(/'/g, "''")   // PowerShell 单引号转义
  const ps = spawn('powershell.exe',
    ['-NoProfile', '-Command',
      `$sh = New-Object -ComObject Shell.Application; ` +
      `$sh.ShellExecute('${q(target)}', '${q(args || '')}', '${q(cwd || '')}', 'runas')`],
    { cwd: cwd || undefined, windowsHide: true })
  ps.on('exit', (code) => {
    if (code !== 0) pushLog(toolId, `[ERROR] 管理员启动被取消或失败(退出码 ${code})`, 'error')
    else pushLog(toolId, `[SUCCESS] 已以管理员权限启动(进程由系统托管)`, 'success')
  })
  ps.unref()
}

// 启动一个工具;返回 { ok, message, system, autoOpenLog }
// v2.0:支持 launchConfig 覆盖项 _args / _cwd / _env(launcher 模块注入)
function run(tool) {
  const target = tool.targetPath
  if (!target) return { ok: false, message: '未设置目标文件' }
  if (!fs.existsSync(target)) {
    logger.warn('runner', `启动失败(文件不存在):${target}`)
    return { ok: false, message: `目标文件不存在:\n${target}` }
  }

  const type = detectType(target) || tool.type
  // 工作目录:launchConfig.cwd(留空 = target 所在目录)
  const dir = (typeof tool._cwd === 'string' && tool._cwd.trim()) ? tool._cwd.trim() : path.dirname(target)
  const mode = resolveMode(tool)
  const runArgs = (typeof tool._args === 'string' && tool._args.trim()) ? tool._args.trim() : ''
  const envExtra = (tool._env && typeof tool._env === 'object') ? tool._env : null

  // 子进程环境变量合并(配置 env 优先,不污染系统环境)
  const childEnv = envExtra ? { ...process.env, ...envExtra } : undefined

  // 更新统计
  tool.runCount = (tool.runCount || 0) + 1
  tool.lastRunAt = new Date().toISOString().slice(0, 19)
  logger.info('runner', `启动工具「${tool.name}」type=${type} mode=${mode} 路径=${target}`)

  const MODE_NAME = { window: '正常窗口', hidden: '隐藏窗口', log: '日志模式', service: '后台服务' }
  pushLog(tool.id, `[INFO] Starting ${tool.name} (${type.toUpperCase()} · ${MODE_NAME[mode] || mode}${runArgs ? ' · 参数: ' + runArgs : ''})`, 'info')

  try {
    /* ---------------- bat / cmd ---------------- */
    if (type === 'bat' || type === 'cmd') {
      if (tool.runAsAdmin) {
        // 管理员运行(UAC):ShellExecute 'runas' 动词,支持参数与工作目录
        runAsAdmin(tool.id, target, runArgs, dir)
        return { ok: true, system: true, message: '已请求管理员权限启动' }
      }
      if (mode === 'window') {
        // 正常窗口:start 弹独立控制台;有参数时一并传给 start
        const child = runArgs
          ? spawn('cmd.exe', ['/c', 'start', '', target, runArgs], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true, env: childEnv })
          : spawn('cmd.exe', ['/c', 'start', '', target], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true, env: childEnv })
        child.unref()
        pushLog(tool.id, `[SUCCESS] 已在独立窗口启动(进程由系统托管)`, 'success')
        notifyChanged()
        return { ok: true, system: true, message: '已启动(独立窗口)' }
      }
      if (mode === 'service') {
        // 后台服务:完全隐藏 + detached,退出玄机不结束
        const child = spawn('cmd.exe', ['/c', target, runArgs].filter(Boolean), { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true, env: childEnv })
        child.unref()
        pushLog(tool.id, `[SUCCESS] 已作为后台服务启动(独立常驻,退出玄机不会结束)`, 'success')
        notifyChanged()
        return { ok: true, system: true, message: '已作为后台服务启动' }
      }
      // hidden / log:隐藏窗口 + 捕获输出
      const child = spawn('cmd.exe', runArgs ? ['/c', target, runArgs] : ['/c', target], { cwd: dir, windowsHide: true, env: childEnv })
      running.set(child.pid, { pid: child.pid, toolId: tool.id, name: tool.name, type, startedAt: Date.now(), process: child, cpu: 0, ram: 0 })
      pushLog(tool.id, `[INFO] 输出捕获中(pid ${child.pid})…`, 'info')
      child.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(tool.id, l.trimEnd())))
      child.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(tool.id, l.trimEnd(), 'error')))
      child.on('exit', (code) => {
        running.delete(child.pid)
        if (code === 0) pushLog(tool.id, `[SUCCESS] 进程正常退出(code 0)`, 'success')
        else pushLog(tool.id, `[ERROR] 进程异常退出(code ${code})`, 'error')
        notifyChanged()
      })
      notifyChanged()
      return { ok: true, pid: child.pid, autoOpenLog: mode === 'log', message: mode === 'log' ? '日志模式运行中' : '已在后台运行' }
    }

    /* ---------------- lnk ---------------- */
    if (type === 'lnk') {
      // lnk:ShellExecute 启动,窗口/权限由快捷方式自身决定,四种模式等价
      shell.openPath(target).then(err => {
        if (err) pushLog(tool.id, `[ERROR] ${err}`, 'error')
        else pushLog(tool.id, `[SUCCESS] 已交给系统启动`, 'success')
      })
      return { ok: true, system: true, message: '已交给系统启动' }
    }

    /* ---------------- exe ---------------- */
    if (type === 'exe') {
      if (tool.runAsAdmin) {
        // 管理员运行:ShellExecute 'runas'(UAC 弹窗),支持参数与工作目录
        runAsAdmin(tool.id, target, runArgs, dir)
        return { ok: true, system: true, message: '已请求管理员权限启动' }
      }
      if (mode === 'service') {
        // 后台服务:detached 独立常驻
        const child = spawn(target, runArgs ? [runArgs] : [], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: true, env: childEnv })
        child.unref()
        pushLog(tool.id, `[SUCCESS] 已作为后台服务启动(独立常驻,退出玄机不会结束)`, 'success')
        notifyChanged()
        return { ok: true, system: true, message: '已作为后台服务启动' }
      }
      // window / hidden / log:异步 spawn;参数以字符串数组传入避免空格拆分问题
      const child = spawn(target, runArgs ? [runArgs] : [], { cwd: dir, windowsHide: mode !== 'window', env: childEnv })
      running.set(child.pid, { pid: child.pid, toolId: tool.id, name: tool.name, type, startedAt: Date.now(), process: child, cpu: 0, ram: 0 })
      pushLog(tool.id, `[INFO] 进程已创建(pid ${child.pid})`, 'info')
      child.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(tool.id, l.trimEnd())))
      child.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(tool.id, l.trimEnd(), 'error')))
      child.on('exit', (code) => {
        running.delete(child.pid)
        if (code === 0) pushLog(tool.id, `[SUCCESS] 进程正常退出(code 0)`, 'success')
        else pushLog(tool.id, `[ERROR] 进程异常退出(code ${code})`, 'error')
        notifyChanged()
      })
      child.on('error', (err) => {
        running.delete(child.pid)
        pushLog(tool.id, `[ERROR] ${err.message}`, 'error')
        notifyChanged()
      })
      notifyChanged()
      return { ok: true, pid: child.pid, autoOpenLog: mode === 'log', message: '已启动' }
    }

    return { ok: false, message: `不支持的文件类型:${path.extname(target) || '未知'}` }
  } catch (err) {
    pushLog(tool.id, `[ERROR] ${err.message}`, 'error')
    return { ok: false, message: '启动失败:' + err.message }
  }
}

/* ---------------- 进程指标采集(每 3s) ---------------- */
let lastSample = new Map()  // pid → cpuSeconds(上次采样)
let lastTime = Date.now()
const cores = os.cpus().length || 1

function collectMetrics() {
  const pids = [...running.keys()]
  if (pids.length === 0) { lastSample.clear(); return }
  const idList = pids.join(',')
  const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
    `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$([math]::Round($_.WS/1KB))|$($_.CPU)" }`],
    { windowsHide: true })
  let out = ''
  ps.stdout.on('data', d => { out += d })
  ps.on('exit', () => {
    const t2 = Date.now()
    const dt = Math.max((t2 - lastTime) / 1000, 0.001)
    const seen = new Map()
    for (const line of out.split(/\r?\n/)) {
      const [pidS, ramKB, cpuS] = line.trim().split('|')
      const pid = Number(pidS)
      if (!pid || !running.has(pid)) continue
      const cpuSeconds = Number(cpuS) || 0
      const prev = lastSample.get(pid)
      const info = running.get(pid)
      info.ram = Number(ramKB) || 0                                    // KB
      info.cpu = prev !== undefined ? Math.max(0, (cpuSeconds - prev) / dt / cores * 100) : 0
      seen.set(pid, cpuSeconds)
    }
    lastSample = seen
    lastTime = t2
    if (seen.size > 0) notifyChanged()
  })
  ps.unref()
}
setInterval(collectMetrics, 3000)

// 当前运行中进程列表(含指标;不含已交给系统的)
function list() {
  return [...running.values()].map(p => ({
    pid: p.pid, toolId: p.toolId, name: p.name, type: p.type, startedAt: p.startedAt,
    cpu: Math.round((p.cpu || 0) * 10) / 10, ram: p.ram || 0
  }))
}

function getLogs(toolId) { return logs.get(toolId) || [] }

function clearLogs(toolId) { logs.delete(toolId); lastAlert.delete(toolId) }

// 强制结束进程(taskkill 带进程树)
function kill(pid) {
  const info = running.get(pid)
  try {
    spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true })
    if (info) { running.delete(pid); notifyChanged() }
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err) } }
}

// v2.1:Command Vault 命令运行(隐藏 cmd /c;输出走 pushLog 全链路 =
// 内存日志 + logstore 落盘 + runner:log 推送,日志中心可实时查看)
// cmdId 作为日志归属 id(命令库条目 id);cwd 空则用进程默认
function runCmd(cmdId, cmdName, rendered, cwd) {
  pushLog(cmdId, `[INFO] 运行命令「${cmdName}」${cwd ? '(cwd ' + cwd + ')' : ''}`, 'info')
  try {
    const child = spawn('cmd.exe', ['/c', rendered], { cwd: cwd || undefined, windowsHide: true })
    running.set(child.pid, { pid: child.pid, toolId: cmdId, name: cmdName, type: 'cmd', startedAt: Date.now(), process: child, cpu: 0, ram: 0 })
    child.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(cmdId, l.trimEnd())))
    child.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(s => s.trim()).forEach(l => pushLog(cmdId, l.trimEnd(), 'error')))
    child.on('exit', (code) => {
      running.delete(child.pid)
      if (code === 0) pushLog(cmdId, `[SUCCESS] 命令执行完成(code 0)`, 'success')
      else pushLog(cmdId, `[ERROR] 命令异常退出(code ${code})`, 'error')
      notifyChanged()
    })
    child.on('error', (err) => {
      running.delete(child.pid)
      pushLog(cmdId, `[ERROR] ${err.message}`, 'error')
      notifyChanged()
    })
    notifyChanged()
    return { ok: true, pid: child.pid }
  } catch (err) {
    pushLog(cmdId, `[ERROR] 启动失败:${err.message}`, 'error')
    return { ok: false, error: String(err) }
  }
}

function killByTool(toolId) {
  for (const [pid, p] of running) {
    if (p.toolId === toolId) kill(pid)
  }
  return { ok: true }
}

function killAll() { for (const pid of running.keys()) kill(pid) }

// 退出时不终止子进程,仅解除关联
function detachAll() {
  for (const [, p] of running) { try { p.process.unref() } catch (_) {} }
  running.clear()
}

module.exports = { run, list, getLogs, clearLogs, kill, killByTool, killAll, detachAll, detectType, runCmd }
