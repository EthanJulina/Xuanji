// ============================================================
// 玄机 - v2.0 → v2.1 配置迁移(P1 四模块落地轮)
// 触发条件:tools.json 的 version 在 [2.0, 2.1) 区间
// 新增字段(全部带默认值,旧数据行为不变):
//   checks: []                     —— 环境健康检查模板(空时种子写入内置预设)
//   tools[].checkIds: []           —— 工具挂载的检查项
//   settings.run: { defaultCwd, dangerPatterns }
//   settings.log: { errorPatterns, warnPatterns, retentionDays, maxFileSizeMB }
//   settings.healthCheck: { cacheTtlSec, blockOnFail }
// 迁移前滚动备份(bak.1/2/3 三代轮换);静默完成,
// 渲染层通过 justMigratedVersion 标志 toast「配置已升级到 v2.1」。
// ============================================================
const fs = require('fs')
const { log } = require('../logger')
const { rotateBackup } = require('./backup')

// 内置健康检查预设(迁移时种子写入;checks 为空才写,不覆盖用户数据)
const HEALTH_PRESETS = [
  {
    id: 'chk-java', name: 'Java 版本', type: 'exec',
    command: 'java -version 2>&1', expectRegex: 'version', timeoutMs: 8000,
    fixTip: '未检测到 Java:请安装 JDK 8+ 并配置 JAVA_HOME 环境变量'
  },
  {
    id: 'chk-python', name: 'Python 版本', type: 'exec',
    command: 'python --version', expectRegex: 'Python', timeoutMs: 8000,
    fixTip: '未检测到 Python:请安装 Python 3.x 并勾选「加入 PATH」'
  },
  {
    id: 'chk-pip', name: 'pip 可用', type: 'exec',
    command: 'pip --version', expectRegex: 'pip', timeoutMs: 8000,
    fixTip: 'pip 不可用:重装 Python 并勾选 pip,或执行 python -m ensurepip'
  },
  {
    id: 'chk-git', name: 'Git 可用', type: 'exec',
    command: 'git --version', expectRegex: 'git version', timeoutMs: 8000,
    fixTip: '未检测到 Git:请安装 Git for Windows 并保持默认 PATH 选项'
  }
]

// v2.1 字段兜底(幂等:缺什么补什么,已存在的不覆盖)
// 同时被 ensureV2Skeleton 风格复用:老配置读出来就是完整形态
function ensureV21(d) {
  if (!Array.isArray(d.checks)) d.checks = []
  for (const t of d.tools || []) {
    if (!Array.isArray(t.checkIds)) t.checkIds = []
  }
  if (!d.settings || typeof d.settings !== 'object') d.settings = {}
  const s = d.settings
  if (!s.run || typeof s.run !== 'object') {
    s.run = {
      defaultCwd: '',
      // 危险命令判定正则(字符串形式,渲染层 new RegExp 匹配渲染后命令)
      dangerPatterns: ['rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)', '\\bformat\\b', '\\bdel\\b', '\\bshutdown\\b', 'reg\\s+delete']
    }
  }
  if (!Array.isArray(s.run.dangerPatterns) || !s.run.dangerPatterns.length) {
    s.run.dangerPatterns = ['rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)', '\\bformat\\b', '\\bdel\\b', '\\bshutdown\\b', 'reg\\s+delete']
  }
  if (!('defaultCwd' in s.run)) s.run.defaultCwd = ''
  if (!s.log || typeof s.log !== 'object') {
    s.log = {
      errorPatterns: ['\\berror\\b', '\\bfatal\\b', 'exception', 'traceback', '失败', '错误'],
      warnPatterns: ['\\bwarn', 'warning', '警告', 'deprecated'],
      retentionDays: 14,
      maxFileSizeMB: 5
    }
  }
  if (!Array.isArray(s.log.errorPatterns)) s.log.errorPatterns = []
  if (!Array.isArray(s.log.warnPatterns)) s.log.warnPatterns = []
  if (!s.log.retentionDays) s.log.retentionDays = 14
  if (!s.log.maxFileSizeMB) s.log.maxFileSizeMB = 5
  if (!s.healthCheck || typeof s.healthCheck !== 'object') {
    s.healthCheck = { cacheTtlSec: 300, blockOnFail: true }
  }
  if (!s.healthCheck.cacheTtlSec) s.healthCheck.cacheTtlSec = 300
  if (!('blockOnFail' in s.healthCheck)) s.healthCheck.blockOnFail = true
  // v2.2.0:全局呼出快捷键(空串 = 禁用;默认 Ctrl+Space,与输入法冲突可改)
  if (typeof s.globalShortcut !== 'string') s.globalShortcut = 'Control+Space'
  return d
}

// 迁移入口;返回 { data, migrated, reason }
function migrate(data, filePath) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tools)) {
    return { data, migrated: false, reason: 'invalid' }
  }
  const ver = parseFloat(data.version) || 0
  if (ver >= 2.1) {
    return { data: ensureV21(data), migrated: false, reason: 'already-v21' }
  }
  // 仅处理 v2.0 数据(v1.x 由 v1-to-v2 先行)
  if (ver < 2.0) {
    return { data, migrated: false, reason: 'need-v2-first' }
  }

  // ---- 1. 滚动备份(迁移前;bak.1/2/3 三代轮换)----
  try {
    if (filePath && fs.existsSync(filePath)) rotateBackup(filePath)
  } catch (e) {
    log('[migrate] v2.0→v2.1 备份失败(继续迁移):' + e)
  }

  // ---- 2. 深拷贝后增量改造 ----
  const out = ensureV21(JSON.parse(JSON.stringify(data)))

  // ---- 3. 种子:内置健康检查预设(仅当用户没有任何自定义检查时)----
  if (out.checks.length === 0) {
    out.checks = JSON.parse(JSON.stringify(HEALTH_PRESETS))
  }

  out.version = '2.1'
  log('[migrate] v2.0→v2.1 迁移完成:检查模板 ' + out.checks.length + ' 个(含预设种子)')
  return { data: out, migrated: true, reason: 'ok' }
}

module.exports = { migrate, ensureV21, HEALTH_PRESETS }
