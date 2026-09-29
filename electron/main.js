// ============================================================
// 玄机 - Electron 主进程
// 职责:无边框毛玻璃窗口(Win11 Mica/Acrylic + CSS 降级)、
//       IPC 路由、托盘、窗口行为(关闭最小化到托盘)
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, globalShortcut } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

// ---- 便携版数据自包含(必须在 require('./store') 之前,store 顶层即取 userData) ----
// electron-builder portable 启动时会设 PORTABLE_EXECUTABLE_DIR = exe 所在目录;
// 数据放 exe 旁 Data/ 文件夹 —— 真正绿色便携,不与安装版/开发版共用 %APPDATA%,
// 也不会读到开发机的个人工具配置
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const portableData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Data')
    fs.mkdirSync(portableData, { recursive: true })
    app.setPath('userData', portableData)
    console.log('[portable] 便携数据目录:' + portableData)
  } catch (e) {
    console.error('[portable] 便携数据目录创建失败(回落默认 userData):', e)
  }
}

const store = require('./store')
const runner = require('./runner')
const icons = require('./icons')
const bridge = require('./main-bridge')
const logger = require('./logger')
// v2.0:领域模块(独立 IPC 前缀,禁止互相穿透)
const workspaceModule = require('./modules/workspace')
const launcherModule = require('./modules/launcher')
const secretModule = require('./modules/secret')
const logstoreModule = require('./modules/logstore')
const commandModule = require('./modules/command')
const healthModule = require('./modules/health')
// v2.0:配置迁移(v1.x → v2.0,含自动备份)
const { migrate } = require('./migrate/v1-to-v2')
// v2.1:配置迁移(v2.0 → v2.1,checks/settings.run/log/healthCheck,含滚动备份)
const { migrate: migrateV21 } = require('./migrate/v2-0-to-v2-1')

// ---- 更名迁移:老版本「工具坞 QuickDock」数据目录 → 新「玄机」目录(一次性、幂等) ----
// productName 决定 userData 目录,更名后旧数据不会自动跟过来;这里在启动最早期搬一次家
function migrateLegacyDataDir() {
  try {
    const newDataDir = app.getPath('userData')
    if (fs.existsSync(path.join(newDataDir, 'tools.json'))) return   // 新目录已有数据,绝不覆盖
    const oldDir = path.join(app.getPath('appData'), '工具坞 QuickDock')
    if (!fs.existsSync(path.join(oldDir, 'tools.json'))) return      // 没有旧数据(全新安装)
    fs.mkdirSync(newDataDir, { recursive: true })
    fs.copyFileSync(path.join(oldDir, 'tools.json'), path.join(newDataDir, 'tools.json'))
    // 图标缓存
    const oldIcons = path.join(oldDir, 'icons')
    if (fs.existsSync(oldIcons)) {
      const newIcons = path.join(newDataDir, 'icons')
      fs.mkdirSync(newIcons, { recursive: true })
      for (const f of fs.readdirSync(oldIcons)) {
        try { fs.copyFileSync(path.join(oldIcons, f), path.join(newIcons, f)) } catch (_) {}
      }
    }
    // 历史日志(app.log 与 app.1~5.log)
    for (const f of fs.readdirSync(oldDir)) {
      if (/^app(\.\d+)?\.log$/.test(f)) {
        try { fs.copyFileSync(path.join(oldDir, f), path.join(newDataDir, f)) } catch (_) {}
      }
    }
    console.log('[migrate] 已从旧数据目录迁移:' + oldDir + ' → ' + newDataDir)
  } catch (e) {
    console.error('[migrate] 旧数据迁移失败(将使用全新数据目录):', e)
  }
}
migrateLegacyDataDir()

let win = null          // 主窗口
let tray = null         // 托盘
let settings = {}       // 主进程侧缓存的设置(关闭行为等)
let quitting = false    // 是否正在真正退出

// ---- GPU 软渲染兜底(两级)----
// 手动:环境变量 QD_DISABLE_GPU=1
// 自动:GPU 进程单次会话内连续崩溃 ≥3 次时写标记文件,下次启动自动软渲染
// 背景:部分显卡驱动上硬件加速会连环 0xC0000005 崩溃,连带渲染进程 crashed → 窗口白屏/冻结(用户感知为「卡死」)
const gpuFlagFile = () => path.join(app.getPath('userData'), 'gpu-fallback.flag')
if (process.env.QD_DISABLE_GPU || fs.existsSync(gpuFlagFile())) {
  app.disableHardwareAcceleration()
  if (fs.existsSync(gpuFlagFile())) console.log('[gpu] 检测到历史 GPU 崩溃标记,本次启动使用软渲染(删除 gpu-fallback.flag 可恢复硬件加速)')
}
let gpuCrashCount = 0

// ---- 是否为 Windows 11(Mica/Acrylic 需要 22000+)----
function isWin11() {
  if (process.platform !== 'win32') return false
  const m = os.release().match(/^10\.0\.(\d+)/)
  return !!m && parseInt(m[1], 10) >= 22000
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,                                  // 无边框窗口
    titleBarStyle: 'hidden',                       // 自定义标题栏
    backgroundColor: '#00000000',                  // 透明底,配合 CSS 毛玻璃
    backgroundMaterial: isWin11() ? 'acrylic' : undefined, // Win11 毛玻璃材质,非 Win11 由 CSS 降级
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  // 注册到桥接模块,供 runner 推送进程/日志事件
  bridge.setWindow(win)

  // 渲染层 console 错误/警告转发到主进程 stdout + 启动日志(便于排查)
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.log(`[renderer:${level === 3 ? 'error' : 'warn'}] ${message} (${sourceId}:${line})`)
      if (level >= 3) logger.error('renderer', `${message} (${sourceId}:${line})`)
      else logger.warn('renderer', `${message} (${sourceId}:${line})`)
    }
  })

  // 开发模式加载 Vite dev server,生产加载 dist
  if (process.env.VITE_DEV) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())

  // 关闭行为:可配置为「最小化到托盘」
  win.on('close', (e) => {
    if (quitting || !settings.closeToTray) return
    e.preventDefault()
    win.hide()
  })

  // 最大化状态变化时通知渲染层(标题栏按钮切换图标)
  win.on('maximize', () => win.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win.webContents.send('win:maximized', false))
}

// ---- 托盘 ----
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  const img = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()
  tray = new Tray(img)
  tray.setToolTip('玄机')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { win.show(); win.focus() } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('double-click', () => { win.show(); win.focus() })
}

// ---- 退出前若有运行中子进程,询问是否终止 ----
async function confirmQuitWithRunningProcs(e) {
  if (quitting) return
  const list = runner.list()
  if (list.length === 0) return
  quitting = true
  e.preventDefault()
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: '退出玄机',
    message: `还有 ${list.length} 个由玄机启动的进程正在运行`,
    detail: list.map(p => `· ${p.name}`).join('\n'),
    buttons: ['终止并退出', '保留进程并退出', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (r.response === 0) { runner.killAll(); quitting = true; app.quit() }
  else if (r.response === 1) { runner.detachAll(); quitting = true; app.quit() }
  else { quitting = false }
}

// ============================================================
// IPC 路由
// ============================================================
function registerIpc() {
  // ---- 窗口控制 ----
  ipcMain.handle('win:minimize', () => win.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('win:isMaximized', () => win.isMaximized())
  // Win11 主题切换材质:dark → acrylic / light → mica
  ipcMain.handle('win:setMaterial', (_e, m) => {
    try { if (isWin11() && win && !win.isDestroyed()) win.setBackgroundMaterial(m) } catch (_) {}
  })
  ipcMain.handle('win:close', () => win.close())
  ipcMain.handle('win:hide', () => win.hide())
  ipcMain.handle('app:quit', () => { quitting = true; app.quit() })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    win11: isWin11(),
    platform: process.platform,
    dataDir: store.dataDir,
    logFile: logger.getLogFile(),
    justMigratedVersion: global.__qdJustMigratedVersion   // 迁移标志:本启动升级到的版本('2.0'/'2.1'/空),渲染层据此 toast
  }))
  // 打开应用日志所在目录
  ipcMain.handle('logger:open', () => {
    const f = logger.getLogFile()
    if (f && fs.existsSync(f)) shell.showItemInFolder(f)
    return true
  })

  // ---- 数据层 ----
  ipcMain.handle('store:load', () => store.load())
  ipcMain.handle('store:save', (_e, data) => store.save(data))
  ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p))
  ipcMain.handle('fs:pathInfo', (_e, p) => {
    // 返回路径基本信息:类型与扩展名,供前端自动识别
    const ext = path.extname(p).toLowerCase()
    return { ext, isFile: fs.existsSync(p) && fs.statSync(p).isFile() }
  })

  // ---- v2.1 资源中心:文本预览(白名单扩展名 + 200 行截断 + 1MB 上限) ----
  const PREVIEW_EXTS = new Set(['.txt', '.md', '.json', '.log', '.js', '.ts', '.py', '.ps1', '.bat', '.cmd', '.conf', '.cfg', '.ini', '.yaml', '.yml', '.xml', '.html', '.css', '.sql', '.sh'])
  ipcMain.handle('resource:preview', (_e, p) => {
    try {
      const ext = path.extname(String(p || '')).toLowerCase()
      if (!PREVIEW_EXTS.has(ext)) {
        return { ok: false, reason: 'not-text', message: `不支持预览 ${ext || '无扩展名'} 文件(白名单外的类型仅支持打开/定位)` }
      }
      if (!fs.existsSync(p)) return { ok: false, reason: 'missing', message: '文件不存在(悬空引用)' }
      const st = fs.statSync(p)
      if (!st.isFile()) return { ok: false, reason: 'not-file', message: '不是文件' }
      if (st.size > 1024 * 1024) return { ok: false, reason: 'too-large', message: '文件超过 1MB,不支持预览' }
      const content = fs.readFileSync(p, 'utf-8')
      const lines = content.split(/\r?\n/)
      const truncated = lines.length > 200
      return { ok: true, ext, size: st.size, lines: truncated ? lines.slice(0, 200) : lines, truncated, totalLines: lines.length }
    } catch (e) {
      return { ok: false, reason: 'error', message: String(e.message || e) }
    }
  })

  // ---- v2.1 资源中心:用系统默认程序打开 ----
  ipcMain.handle('resource:open', async (_e, p) => {
    if (!fs.existsSync(p)) return { ok: false, message: '文件不存在(悬空引用)' }
    const err = await shell.openPath(String(p))
    return err ? { ok: false, message: err } : { ok: true }
  })

  // ---- 文件选择器 ----
  ipcMain.handle('dialog:pickTool', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择工具文件',
      properties: ['openFile'],
      filters: [
        { name: '支持的文件 (bat/cmd/lnk/exe)', extensions: ['bat', 'cmd', 'lnk', 'exe'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp'] }]
    })
    if (r.canceled) return null
    const p = r.filePaths[0]
    if (fs.statSync(p).size > 1024 * 1024) return { error: '图片超过 1MB,请换一张小一点的' }
    return { dataUrl: 'data:image/' + path.extname(p).slice(1).replace('jpg', 'jpeg') + ';base64,' + fs.readFileSync(p).toString('base64') }
  })

  // v2.0:目录选择器(工作空间「项目目录」用;选文件夹而非文件)
  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择目录',
      properties: ['openDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // ---- 图标 ----
  ipcMain.handle('icon:get', (_e, toolId, targetPath) => icons.getIcon(toolId, targetPath))
  ipcMain.handle('icon:remove', (_e, toolId) => icons.removeIcon(toolId))

  // ---- 运行器 ----
  ipcMain.handle('runner:run', (_e, tool) => runner.run(tool))
  ipcMain.handle('runner:list', () => runner.list())
  ipcMain.handle('runner:logs', (_e, toolId) => runner.getLogs(toolId))
  ipcMain.handle('runner:clearLogs', (_e, toolId) => { runner.clearLogs(toolId); return { ok: true } })
  ipcMain.handle('runner:kill', (_e, pid) => runner.kill(pid))
  ipcMain.handle('runner:killByTool', (_e, toolId) => runner.killByTool(toolId))

  // ---- 日志面板辅助:复制 / 另存 ----
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return { ok: true } })
  ipcMain.handle('dialog:saveLogs', async (_e, { toolName, lines }) => {
    const r = await dialog.showSaveDialog(win, {
      title: '保存日志',
      defaultPath: `${toolName || '工具'}-日志-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: '文本', extensions: ['txt'] }]
    })
    if (r.canceled) return { ok: false }
    try {
      fs.writeFileSync(r.filePath, lines.join('\n'), 'utf-8')
      return { ok: true, path: r.filePath }
    } catch (err) { return { ok: false, error: String(err) } }
  })

  // ---- 预设工具包:一键导入常用工具骨架(按目标路径去重,不覆盖手动添加) ----
  ipcMain.handle('preset:import', () => {
    const presets = [
      { name: '一键清理缓存', type: 'bat', targetPath: '', desc: '示例:清理临时文件', categoryId: null },
      { name: 'CMD 终端', type: 'exe', targetPath: 'C:\\Windows\\System32\\cmd.exe', desc: 'Windows 命令行', categoryId: null },
      { name: '任务管理器', type: 'exe', targetPath: 'C:\\Windows\\System32\\Taskmgr.exe', desc: '系统进程管理', categoryId: null },
      { name: '记事本', type: 'exe', targetPath: 'C:\\Windows\\System32\\notepad.exe', desc: '文本编辑', categoryId: null }
    ]
    const exists = new Set(store.load().tools.map(t => t.targetPath))
    const data = store.load()
    let added = 0
    const maxOrder = data.tools.reduce((m, t) => Math.max(m, t.sortOrder || 0), 0)
    for (const p of presets) {
      if (!p.targetPath || exists.has(p.targetPath)) continue
      if (!fs.existsSync(p.targetPath)) continue
      data.tools.push({
        id: require('crypto').randomUUID(),
        name: p.name, type: p.type, targetPath: p.targetPath, desc: p.desc,
        categoryId: p.categoryId, icon: 'auto', pinned: false,
        runMode: p.type === 'bat' ? 'log' : 'window',
        runAsAdmin: false, confirmBeforeRun: false,
        runCount: 0, lastRunAt: null, sortOrder: maxOrder + ++added
      })
    }
    if (added > 0) store.save(data)
    return { ok: true, added }
  })

  // ---- Shell ----
  ipcMain.handle('shell:showInFolder', (_e, p) => { shell.showItemInFolder(p) })

  // ---- 导出 / 导入配置 ----
  ipcMain.handle('config:export', async (_e, data) => {
    const r = await dialog.showSaveDialog(win, {
      title: '导出配置',
      defaultPath: 'xuanji-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled) return { ok: false }
    try {
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { ok: true, path: r.filePath }
    } catch (err) { return { ok: false, error: String(err) } }
  })
  ipcMain.handle('config:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '导入配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled) return null
    try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf-8')) }
    catch (err) { return { error: '配置文件解析失败:' + err.message } }
  })

  // ---- 设置(主进程关心的部分) ----
  ipcMain.handle('settings:sync', (_e, s) => {
    settings = { closeToTray: !!s.closeToTray }
    // v2.1:日志等级判定配置热更新(渲染层保存设置后立即生效)
    logstoreModule.configure(s.log)
    // v2.2.0:全局呼出快捷键热更新(变更才重注册,避免每次设置保存都闪断)
    const acc = typeof s.globalShortcut === 'string' ? s.globalShortcut : 'Control+Space'
    if (acc !== globalShortcutAcc) applyGlobalShortcut(acc)
    if (tray) tray.setImage(
      fs.existsSync(path.join(__dirname, '..', 'build', 'icon.png'))
        ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 })
        : nativeImage.createEmpty()
    )
  })
}

// ---- 全局快捷键:任意界面呼出/隐藏窗口并聚焦命令面板 ----
// v2.2.0:快捷键可自定义(settings.globalShortcut,Electron accelerator 格式;
// 空串 = 禁用)。默认 Control+Space —— 注意它与中文系统输入法中英文切换冲突,
// 打字误触呼出的用户可在设置页改为其他组合键
let globalShortcutAcc = 'Control+Space'   // 当前生效的快捷键(主进程缓存)
function toggleQuickLauncher() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && win.isFocused()) {
    win.hide()                       // 已在前台 → 隐藏到托盘(再按一次即呼出)
  } else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('palette:toggle')   // 呼出时直接聚焦命令面板
  }
}

// (重新)注册全局快捷键;结果推送渲染层弹 toast。settings.globalShortcut 为空 = 禁用
function applyGlobalShortcut(accelerator) {
  try { globalShortcut.unregisterAll() } catch (_) {}
  globalShortcutAcc = String(accelerator || '').trim()
  if (!globalShortcutAcc) {
    logger.info('shortcut', '全局呼出快捷键已禁用')
    if (win && !win.isDestroyed()) win.webContents.send('shortcut:result', { ok: true, accelerator: '', disabled: true })
    return
  }
  try {
    const ok = globalShortcut.register(globalShortcutAcc, toggleQuickLauncher)
    ok ? logger.info('shortcut', `全局快捷键 ${globalShortcutAcc} 注册成功`)
       : logger.warn('shortcut', `全局快捷键 ${globalShortcutAcc} 注册失败(可能被其他应用占用)`)
    if (win && !win.isDestroyed()) {
      win.webContents.send('shortcut:result', ok
        ? { ok: true, accelerator: globalShortcutAcc }
        : { ok: false, accelerator: globalShortcutAcc, message: '快捷键被其他程序占用,未生效(换一个组合键试试)' })
    }
  } catch (e) {
    logger.error('shortcut', `全局快捷键 ${globalShortcutAcc} 注册异常:${e}`)
    if (win && !win.isDestroyed()) win.webContents.send('shortcut:result', { ok: false, accelerator: globalShortcutAcc, message: '快捷键格式无效' })
  }
}

// ============================================================
// 应用生命周期
// ============================================================
app.whenReady().then(() => {
  // ---- 启动日志:每次启动覆盖上一份(userData/app.log)----
  logger.boot(store.dataDir, {
    '应用版本': app.getVersion(),
    'Electron': process.versions.electron,
    '系统': `${process.platform} ${os.release()}`,
    'Win11 材质': isWin11() ? '可用' : '不可用(CSS 降级)',
    '软渲染兜底': process.env.QD_DISABLE_GPU ? '开启' : '关闭',
    '数据目录': store.dataDir
  })
  logger.info('boot', '应用启动完成')

  // 全局异常捕获 → 日志
  process.on('uncaughtException', (e) => logger.error('process', `未捕获异常:${e.stack || e}`))
  process.on('unhandledRejection', (e) => logger.error('process', `未处理的 Promise 拒绝:${e && (e.stack || e)}`))
  // 子进程崩溃(渲染层/GPU/工具类)→ 日志;GPU 连环崩自动标记软渲染
  let gpuFlagWritten = false
  app.on('child-process-gone', (_e, details) => {
    logger.error('child-process', `${details.type} 异常退出 reason=${details.reason} exitCode=${details.exitCode}`)
    if (details.type === 'GPU' && details.reason === 'crashed' && !gpuFlagWritten) {
      gpuCrashCount++
      if (gpuCrashCount >= 3) {
        gpuFlagWritten = true
        try { fs.writeFileSync(gpuFlagFile(), String(Date.now())) } catch (_) {}
        logger.warn('child-process', 'GPU 连续崩溃 3 次,已标记下次启动使用软渲染(删除数据目录 gpu-fallback.flag 可恢复)')
      }
    }
  })
  app.on('render-process-gone', (_e, _wc, details) => {
    logger.error('renderer', `渲染进程异常退出 reason=${details.reason} exitCode=${details.exitCode}`)
    // 崩溃自愈:渲染进程 crashed/oom 后窗口白屏冻结(用户感知为「卡死」),自动重载页面恢复
    // smoke 模式不自动重载(离屏窗口有独立的探针时序)
    if (!process.env.QD_SMOKE && (details.reason === 'crashed' || details.reason === 'oom')) {
      setTimeout(() => {
        try {
          if (win && !win.isDestroyed()) {
            logger.info('renderer', '崩溃自愈:正在重载页面')
            win.webContents.reload()
          }
        } catch (_) {}
      }, 800)
    }
  })

  store.ensureDirs()
  // ---- 数据迁移链:启动时静默完成,v1→v2.0 → v2.0→v2.1 串行 ----
  // 每级迁移内部自行判 version 区间、备份、幂等改造;
  // 迁移标志存 global(registerIpc 定义在 whenReady 之外,闭包取不到局部变量)
  global.__qdJustMigratedVersion = ''
  {
    const raw = store.load()
    let data = raw
    // 第一级:v1.x → v2.0(launchConfig 生成、分类/工作空间骨架)
    const r2 = migrate(data, store.file)
    data = r2.data
    if (r2.migrated) {
      global.__qdJustMigratedVersion = '2.0'
      logger.info('store', `配置已升级到 v2.0(旧配置已备份):分类 ${data.categories.length} 个,工具 ${data.tools.length} 个,工作空间 ${data.workspaces.length} 个`)
    }
    // 第二级:v2.0 → v2.1(checks / settings.run / settings.log / settings.healthCheck,滚动备份 bak.1/2/3)
    const r21 = migrateV21(data, store.file)
    data = r21.data
    if (r21.migrated) {
      global.__qdJustMigratedVersion = '2.1'   // 渲染层据此 toast「配置已升级到 v2.1」
      logger.info('store', `配置已升级到 v2.1(旧配置已滚动备份 bak.1/2/3):检查模板 ${data.checks.length} 个`)
    }
    // 统一落盘:未迁移时同样写回,保证骨架字段完整(幂等)
    store.save(data)
  }
  const loaded = store.load()
  settings = loaded.settings || {}
  // v2.1:日志中心配置注入(等级判定正则/轮转/保留天数)
  logstoreModule.configure(settings.log)
  logstoreModule._startMaintenanceTimer()
  registerIpc()
  // v2.0/v2.1 领域模块注册(各自独立 IPC 前缀)
  workspaceModule.register()
  launcherModule.register()
  secretModule.register()
  logstoreModule.register()
  commandModule.register()
  healthModule.register()
  createTray()
  createWindow()

  // 注册全局快捷键(系统级,窗口隐藏时同样生效;可在设置页自定义或禁用)
  // 启动序:store.load 在 ready 前的迁移块里已落定,这里直接读
  try {
    const saved = (store.load().settings && store.load().settings.globalShortcut)
    applyGlobalShortcut(typeof saved === 'string' ? saved : 'Control+Space')
  } catch (e) {
    logger.error('shortcut', `全局快捷键注册异常:${e}`)
    applyGlobalShortcut('Control+Space')
  }

  app.on('before-quit', (e) => { if (!quitting) confirmQuitWithRunningProcs(e) })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()   // 退出时释放全局热键
    logger.shutdown('会话结束'); quitting = true
  })
  app.on('window-all-closed', () => { /* 托盘常驻,不自动退出 */ })

  // Smoke 截图模式:额外创建离屏窗口(软件光栅化)验证 UI 渲染,不依赖 GPU
  if (process.env.QD_SMOKE_SHOT) {
    const shotFile = path.join(__dirname, '..', 'ui-shot.png')
    try { fs.rmSync(shotFile, { force: true }) } catch (_) {}
    const off = new BrowserWindow({
      width: 1180, height: 760, show: false, frame: false,
      webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
    })
    off.webContents.setFrameRate(5)
    off.webContents.on('paint', (_e, _dirty, image) => {
      try {
        const png = image.toPNG()
        if (png.length > 1000) fs.writeFileSync(shotFile, png) // 跳过空白首帧
      } catch (_) {}
    })
    if (process.env.VITE_DEV) off.loadURL('http://127.0.0.1:5173')
    else off.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Smoke 退出定时:截图模式下 10 秒后退出
  if (process.env.QD_SMOKE_SHOT) {
    setTimeout(() => { quitting = true; app.quit() }, 10000)
  }

  // Smoke 测试模式:启动 3 秒后自动退出(CI / 自检用)
  // 结果写入 smoke-result.txt(Windows 下 console.log 在立即退出时可能丢失缓冲)
  if (process.env.QD_SMOKE) {
    setTimeout(async () => {
      const out = [
        'QD_SMOKE_OK',
        'dataDir = ' + store.dataDir,
        'tools.json exists = ' + fs.existsSync(store.file)
      ]
      if (process.env.QD_SMOKE_RUN) {
        const os = require('os')
        const dir = path.join(os.tmpdir(), 'qd smoke 中文 空格目录')
        fs.mkdirSync(dir, { recursive: true })
        const bat = path.join(dir, '测试 脚本.bat')
        fs.writeFileSync(bat, '@echo off\r\necho HELLO_FROM_BAT\r\nexit /b 0\r\n', 'utf-8')
        const batErr = path.join(dir, '异常输出.bat')
        fs.writeFileSync(batErr, '@echo off\r\necho Error: JAVA_HOME is not defined\r\njava -version\r\nexit /b 1\r\n', 'utf-8')
        // 四档启动模式 + 异常识别
        const r1 = runner.run({ id: 'smoke-1', name: '日志模式脚本', type: 'bat', targetPath: bat, runMode: 'log' })
        out.push('RUN BAT(log) = ' + JSON.stringify(r1))
        const r2 = runner.run({ id: 'smoke-2', name: '不存在', type: 'exe', targetPath: 'C:/不存在 的文件/xx.exe' })
        out.push('RUN MISSING = ' + JSON.stringify(r2))
        const r3 = runner.run({ id: 'smoke-3', name: '后台服务', type: 'bat', targetPath: bat, runMode: 'service' })
        out.push('RUN BAT(service) = ' + JSON.stringify(r3))
        const r4 = runner.run({ id: 'smoke-4', name: '正常窗口', type: 'bat', targetPath: bat, runMode: 'window' })
        out.push('RUN BAT(window) = ' + JSON.stringify(r4))
        const r5 = runner.run({ id: 'smoke-5', name: '异常识别', type: 'bat', targetPath: batErr, runMode: 'log' })
        out.push('RUN BAT(err-scan) = ' + JSON.stringify(r5))
        const batLong = path.join(dir, '长跑 脚本.bat')
        fs.writeFileSync(batLong, '@echo off\r\necho LONG_RUNNING\r\nping -n 12 127.0.0.1 >nul\r\nexit /b 0\r\n', 'utf-8')
        const r6 = runner.run({ id: 'smoke-6', name: '指标采集', type: 'bat', targetPath: batLong, runMode: 'log' })
        out.push('RUN BAT(long) = ' + JSON.stringify(r6))
        // 等待 bat 执行完毕 + 指标采集(3s 周期需两轮)后写结果
        setTimeout(() => {
          out.push('LOGS smoke-1(autoOpen?) = ' + JSON.stringify(runner.getLogs('smoke-1').map(l => l.level + ':' + l.text.slice(0, 40))))
          out.push('LOGS smoke-5(异常识别) = ' + JSON.stringify(runner.getLogs('smoke-5').map(l => l.level + ':' + l.text.slice(0, 50))))
          out.push('PROCS(含指标) = ' + JSON.stringify(runner.list()))
          runner.killAll()
          fs.writeFileSync(path.join(__dirname, '..', 'smoke-result.txt'), out.join('\n'), 'utf-8')
          quitting = true
          app.quit()
        }, 8500)
        return
      }
      // DOM 探针:统计页面真实渲染结果(不依赖 GPU 出帧;4s 超时兜底)
      // v2.0 默认视图为 home 首页,探针同时覆盖首页与工具视图两种形态
      try {
        const probe = await Promise.race([
          win.webContents.executeJavaScript(`(() => ({
            home: !!document.querySelector('.home'),
            greet: (document.querySelector('.hero-greet')?.textContent || '').trim().slice(0, 24),
            wsCards: document.querySelectorAll('.ws-card').length,
            cards: document.querySelectorAll('.tool-card').length,
            groups: document.querySelectorAll('.group').length,
            icons: document.querySelectorAll('.tool-icon img').length,
            sidebarItems: document.querySelectorAll('.side-item, .sb-item, .nav-item').length,
            deadNodes: document.querySelectorAll('toolcard').length + document.querySelectorAll('toolicon').length,
            hasBurp: document.body.innerText.includes('Burp Suite'),
            hasPiik: document.body.innerText.includes('Piik')
          }))()`, true),
          new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ])
        out.push(probe ? 'DOM = ' + JSON.stringify(probe) : 'DOM PROBE TIMEOUT(渲染器本会话不可用)')
      } catch (err) { out.push('DOM PROBE FAIL: ' + String(err)) }
      fs.writeFileSync(path.join(__dirname, '..', 'smoke-result.txt'), out.join('\n'), 'utf-8')
      quitting = true
      app.quit()
    }, 3000)
  }
})
