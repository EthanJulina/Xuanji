// ============================================================
// 玄机 - 数据层
// tools.json 原子写入:先写临时文件,再重命名覆盖
// ============================================================
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { ensureV2Skeleton } = require('./migrate/v1-to-v2')
const { ensureV21 } = require('./migrate/v2-0-to-v2-1')

const dataDir = app.getPath('userData')          // 如 %APPDATA%/quickdock
const iconDir = path.join(dataDir, 'icons')
const file = path.join(dataDir, 'tools.json')

// 默认数据结构(首次启动)—— v2.1 骨架
function defaults() {
  return {
    version: '2.1',
    categories: [
      { id: 'cat-system', name: '系统维护', emoji: '🛠', color: '#4F8CFF', sortOrder: 1 },
      { id: 'cat-scripts', name: '脚本', emoji: '📜', color: '#8C6FFF', sortOrder: 2 }
    ],
    tools: [],
    workspaces: [],      // P0 工作空间
    commands: [],        // P1 Command Vault(命令模板)
    resources: [],       // P1 Payload/Resource 中心(引用式管理)
    globalVars: {},      // P1 全局变量
    checks: [],          // P1 环境健康检查模板
    proxy: {             // P2 Proxy Manager(占位;实现时须遵守安全红线)
      profiles: [], current: null, snapshot: null
    },
    sessions: [],        // P2 测试记录(占位)
    settings: {
      theme: 'dark',           // dark | light | system
      closeToTray: true,       // 关闭时最小化到托盘
      sortMode: 'manual',      // manual | name | frequent
      showDock: true,          // 旧开关(兼容保留,Dock 实际读 settings.dock.mode)
      defaultView: 'home',     // v2:启动默认页 home | all | last
      lastView: null,          // v2:「上次视图」记忆(defaultView = 'last' 时用)
      run: {                   // v2.1:命令运行设置
        defaultCwd: '',        // 命令运行默认工作目录(空 = 当前工作空间第一个 path)
        dangerPatterns: []     // 危险命令正则(字符串形式;由 v2.1 迁移填充默认)
      },
      log: {                   // v2.1:日志中心设置
        errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5
      },
      healthCheck: { cacheTtlSec: 300, blockOnFail: true }   // v2.1:健康检查
    }
  }
}

function ensureDirs() {
  fs.mkdirSync(iconDir, { recursive: true })
  // v2.1:日志中心 jsonl 落盘目录
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true })
}

// 读取配置;文件损坏时回退默认并保留损坏文件便于排查
// v2.0:字段兜底由 migrate/v1-to-v2 的 ensureV2Skeleton 统一完成,
//       保证老配置缺 workspaces 等新字段时读出来就是完整形态
function load() {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const data = JSON.parse(raw)
    const d = defaults()
    const patched = ensureV21(ensureV2Skeleton({
      version: data.version || d.version,
      categories: Array.isArray(data.categories) ? data.categories : d.categories,
      tools: Array.isArray(data.tools) ? data.tools : d.tools,
      settings: Object.assign({}, d.settings, data.settings || {})
    }))
    // 保留老数据里的其余实体(导入场景可能带全量字段)
    for (const k of ['workspaces', 'commands', 'resources', 'globalVars', 'checks', 'proxy', 'sessions', 'combos']) {
      if (data[k] !== undefined) patched[k] = data[k]
    }
    return patched
  } catch (e) {
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, file + '.broken') } catch (_) {}
    }
    return defaults()
  }
}

// 原子写入:写 tmp → 删旧 → rename,避免写一半崩溃导致配置损坏
function save(data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  try { fs.rmSync(file, { force: true }) } catch (_) {}
  fs.renameSync(tmp, file)
  return true
}

module.exports = { dataDir, iconDir, file, ensureDirs, load, save, defaults }
