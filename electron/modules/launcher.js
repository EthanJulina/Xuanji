// ============================================================
// 玄机 - 启动器域(主进程模块)
// 职责:launcher: 前缀 IPC —— 以指定启动配置运行工具
// 兼容回落规则(需求 7.2):
//   运行时优先取 active 配置;某字段为空或配置缺失时
//   回落到工具顶层旧字段(runMode/runAsAdmin),保证旧数据行为不变
// 预留:P1 启动前健康检查钩子 beforeLaunch(本期仅占位函数)
// ============================================================
const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const runner = require('../runner')
const store = require('../store')
const logger = require('../logger')
const health = require('./health')

// v2.1 实装:启动前健康检查
// 工具挂了 checkIds 时跑检查(走 TTL 缓存);
// blockOnFail=true 且存在红项 → 拦截启动(渲染层可带 skipHealth 强制覆盖);
// blockOnFail=false → 仅收集 warnings 不拦截
async function beforeLaunch(tool, launchConfig, skipHealth = false) {
  const ids = Array.isArray(tool.checkIds) ? tool.checkIds.filter(Boolean) : []
  if (!ids.length || skipHealth) return { ok: true, results: [], warnings: [] }
  try {
    const results = await health.runChecks(ids, false)
    const failed = results.filter(r => !r.ok)
    const { blockOnFail } = health.loadHealthSettings()
    if (failed.length && blockOnFail) {
      logger.warn('launcher', `「${tool.name}」健康检查未通过 ${failed.length}/${results.length} 项,已拦截启动`)
      return { ok: false, blocked: true, results, warnings: [] }
    }
    return { ok: true, results, warnings: failed.map(f => `${f.name}:${f.message}`) }
  } catch (e) {
    // 检查链路本身异常不阻塞启动(记录即可)
    logger.error('launcher', `健康检查异常(放行):${e}`)
    return { ok: true, results: [], warnings: [] }
  }
}

// 解析工具的有效启动参数(回落规则核心):
//   1. launchConfig = tool.launchConfigs 中 activeLaunchConfigId 指向的项
//   2. 未指定 configId 时取 active;指定了但找不到也回落 active
//   3. 每个字段独立回落:
//        args/cwd/env:配置里为空 → 视为无(空串/空对象)
//        runAsAdmin:配置未定义(undefined)→ 回落工具顶层
//        runMode:配置未定义 → 回落工具顶层;顶层也没有 → showWindow 推断
//        captureLog:由 runMode 推导(hidden/log = true)
function resolveLaunch(tool, configId) {
  const configs = Array.isArray(tool.launchConfigs) ? tool.launchConfigs : []
  let cfg = null
  if (configId) cfg = configs.find(c => c.id === configId) || null
  if (!cfg) cfg = configs.find(c => c.id === tool.activeLaunchConfigId) || configs[0] || null

  // 顶层旧字段(兜底值)
  const fallbackAdmin = tool.runAsAdmin === true
  const fallbackMode = tool.runMode || (tool.showWindow === false ? 'log' : 'window')

  // 兼容 v2 schema 的 showWindow/captureLog 布尔:
  // 配置存了 runMode(四档,权威)时按 runMode 推导;否则看布尔字段
  let runMode = cfg && cfg.runMode ? cfg.runMode : fallbackMode
  if (cfg && !cfg.runMode) {
    // 只有 showWindow/captureLog 的旧式配置:映射回四档
    if (cfg.captureLog === true) runMode = 'log'
    else if (cfg.showWindow === false) runMode = 'hidden'
    else if (cfg.showWindow === undefined) runMode = fallbackMode
    else runMode = 'window'
  }

  return {
    launchConfig: cfg,
    args: (cfg && typeof cfg.args === 'string' && cfg.args.trim()) ? cfg.args.trim() : '',
    cwd: (cfg && typeof cfg.cwd === 'string' && cfg.cwd.trim()) ? cfg.cwd.trim() : '',
    env: (cfg && cfg.env && typeof cfg.env === 'object' && !cfg.env.encrypted) ? { ...cfg.env } : {},
    runAsAdmin: cfg && cfg.runAsAdmin !== undefined ? !!cfg.runAsAdmin : fallbackAdmin,
    runMode,
    captureLog: runMode === 'hidden' || runMode === 'log'
  }
}

function register() {
  // 以指定(或默认)启动配置运行工具
  // payload: { tool, configId? }
  ipcMain.handle('launcher:run', async (_e, payload) => {
    const tool = payload && payload.tool
    if (!tool || !tool.id) return { ok: false, message: '无效的工具对象' }

    // 主进程侧再读一次最新数据,避免渲染层对象过期
    const data = store.load()
    const fresh = data.tools.find(t => t.id === tool.id) || tool

    const r = resolveLaunch(fresh, payload.configId)

    // v2.1:启动前健康检查(挂 checkIds 才生效;skipHealth = 渲染层确认后强制启动)
    const healthResult = await beforeLaunch(fresh, r.launchConfig, !!payload.skipHealth)
    if (!healthResult.ok) {
      return {
        ok: false,
        blocked: true,
        message: '启动前环境检查未通过',
        results: healthResult.results || []
      }
    }

    // 组装 runner 需要的完整参数(含配置覆盖项)
    const launchTarget = {
      ...fresh,
      runAsAdmin: r.runAsAdmin,   // 配置级管理员覆盖
      runMode: r.runMode,         // 配置级运行方式覆盖
      // launcher 专用字段(runner.run 内部消费)
      _args: r.args,
      _cwd: r.cwd || (fresh.targetPath ? path.dirname(fresh.targetPath) : ''),
      _env: r.env
    }

    // cwd 校验:配置了工作目录但目录不存在时警告并回落到 target 所在目录
    if (r.cwd && !fs.existsSync(r.cwd)) {
      logger.warn('launcher', `配置的工作目录不存在,已回落:${r.cwd}`)
      launchTarget._cwd = fresh.targetPath ? path.dirname(fresh.targetPath) : ''
    }

    const result = runner.run(launchTarget)
    if (result.ok) {
      logger.info('launcher', `「${fresh.name}」以配置「${r.launchConfig ? r.launchConfig.name : '默认'}」启动:args="${r.args}" cwd="${launchTarget._cwd}" mode=${r.runMode}`)
      // v2.1:检查警告随启动结果透传(blockOnFail=false 时红项放行的提示)
      if (healthResult.warnings && healthResult.warnings.length) {
        result.warnings = healthResult.warnings
      }
    }
    return result
  })

  // 供渲染层查询某工具的有效启动配置(回落解析结果,展示用)
  ipcMain.handle('launcher:resolve', (_e, { tool, configId }) => {
    const data = store.load()
    const fresh = data.tools.find(t => t.id === tool.id) || tool
    return resolveLaunch(fresh, configId)
  })
}

module.exports = { register, resolveLaunch, beforeLaunch }
