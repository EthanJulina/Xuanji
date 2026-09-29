// ============================================================
// 玄机 - v1.x → v2.0 配置迁移(独立文件,不与业务代码混合)
// 触发条件:tools.json 的 version < 2.0
// 动作:
//   1. 迁移前自动备份为 tools.json.bak(只留最近一份)
//   2. 每个旧工具生成一条「默认配置」launchConfig,
//      继承原有 runAsAdmin / runMode(四档运行方式)字段,
//      activeLaunchConfigId 指向它 —— 保证旧数据行为完全不变
//   3. 补齐 v2.0 顶层骨架:workspaces / commands / resources /
//      globalVars / proxy / sessions(P1/P2 仅数据结构占位)
//   4. 顶层旧字段(runMode / runAsAdmin 等)全部保留作回落兜底:
//      运行时 launchConfig 某字段缺失 → 回落工具顶层旧字段
// 迁移在启动时静默完成;渲染层通过 justMigratedV2 标志
// 决定是否 toast「配置已升级到 v2.0」。
// ============================================================
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { log } = require('../logger')
const { rotateBackup } = require('./backup')

// 生成一个不带连字符的短 id(与现有 cat-/combo- 风格一致)
function shortId(prefix) {
  return (prefix ? prefix + '-' : '') + crypto.randomUUID().slice(0, 8)
}

// 迁移入口;返回 { data, migrated, reason }
//   migrated = true  表示确实发生了 v1 → v2 升级(渲染层据此弹 toast)
function migrate(data, filePath) {
  // 异常防御:数据必须可解析且包含 tools 数组
  if (!data || typeof data !== 'object' || !Array.isArray(data.tools)) {
    return { data, migrated: false, reason: 'invalid' }
  }
  // 已是 v2.0(或更高):只做字段兜底,不算迁移
  const ver = parseFloat(data.version) || 1.0
  if (ver >= 2.0) {
    const patched = ensureV2Skeleton(data)
    return { data: patched, migrated: false, reason: 'already-v2' }
  }

  // ---- 1. 备份旧配置(迁移前;滚动轮换 bak.1/2/3,防多次升级覆盖最早备份)----
  try {
    if (fs.existsSync(filePath)) {
      rotateBackup(filePath)
    }
  } catch (e) {
    // 备份失败时继续迁移:迁移本身是增量补字段,破坏性极低;
    // 但把失败写入应用日志,便于排查
    log('[migrate] v1→v2 备份失败(继续迁移):' + e)
  }

  // ---- 2. 深拷贝后开始改造(绝不原地修改传入对象)----
  const out = JSON.parse(JSON.stringify(data))

  // ---- 3. 每个旧工具生成「默认配置」launchConfig ----
  for (const t of out.tools) {
    if (!Array.isArray(t.launchConfigs) || t.launchConfigs.length === 0) {
      const cfg = {
        id: shortId('lc'),
        name: '默认启动',
        args: '',
        cwd: '',
        env: {},
        // runMode 为玄机实际四档运行方式(window/hidden/log/service);
        // schema 中的 showWindow/captureLog 是它的简化映射:
        //   showWindow = (runMode === 'window')
        //   captureLog = (runMode === 'hidden' || runMode === 'log')
        // 迁移时以 runMode 为准写入,保证旧数据行为不变
        runAsAdmin: !!t.runAsAdmin,
        runMode: t.runMode || (t.showWindow === false ? 'log' : 'window'),
        showWindow: t.runMode ? t.runMode === 'window' : t.showWindow !== false,
        captureLog: t.runMode ? (t.runMode === 'hidden' || t.runMode === 'log') : (t.showWindow === false)
      }
      t.launchConfigs = [cfg]
      t.activeLaunchConfigId = cfg.id
    } else {
      // 已有配置(理论上 v1 不会出现,防御性处理):保证 active 指向有效项
      const ids = t.launchConfigs.map(c => c.id)
      if (!ids.includes(t.activeLaunchConfigId)) {
        t.activeLaunchConfigId = ids[0]
      }
    }
  }

  // ---- 4. 补齐 v2.0 顶层骨架 ----
  ensureV2Skeleton(out)

  out.version = '2.0'

  log('[migrate] v1→v2 迁移完成:工具 ' + out.tools.length + ' 个,' +
      '工作空间 ' + (out.workspaces || []).length + ' 个')
  return { data: out, migrated: true, reason: 'ok' }
}

// v2.0 顶层骨架:缺什么补什么,已存在的不覆盖(幂等)
// P1/P2 实体本期只落数据结构,不写任何业务 UI 与逻辑
function ensureV2Skeleton(d) {
  if (!Array.isArray(d.workspaces)) d.workspaces = []
  if (!Array.isArray(d.commands)) d.commands = []          // P1 Command Vault
  if (!Array.isArray(d.resources)) d.resources = []        // P1 Payload/Resource 中心
  if (!d.globalVars || typeof d.globalVars !== 'object') d.globalVars = {}
  if (!d.proxy || typeof d.proxy !== 'object') {           // P2 Proxy Manager
    d.proxy = { profiles: [], current: null, snapshot: null }
  }
  if (!Array.isArray(d.sessions)) d.sessions = []          // P2 测试记录
  if (!d.settings || typeof d.settings !== 'object') d.settings = {}
  if (!('defaultView' in d.settings)) d.settings.defaultView = 'home'
  // 兼容:settings.lastView 由渲染层记忆「上次视图」(defaultView = 'last' 时用)
  if (!('lastView' in d.settings)) d.settings.lastView = null
  return d
}

module.exports = { migrate, ensureV2Skeleton }
