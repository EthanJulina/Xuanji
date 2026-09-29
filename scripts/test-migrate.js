// ============================================================
// v1→v2 迁移单元测试(纯 Node,不依赖 Electron)
// 运行:node scripts/test-migrate.js
// 覆盖:旧数据迁移 / 幂等 / 新装兜底 / 回落规则解析
// ============================================================
const path = require('path')
const fs = require('fs')
const os = require('os')

// migrate 模块依赖 logger(其内部 fs 操作在未 boot 时静默失败,不影响测试)
const { migrate, ensureV2Skeleton } = require(path.join(__dirname, '..', 'electron', 'migrate', 'v1-to-v2'))

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.error('  ✗ ' + name) }
}

// 模拟 v1.3 真实数据
const v1Data = {
  version: '1.3',
  categories: [{ id: 'cat-1', name: '安全测试', emoji: '🔐', color: '#E05F5F', sortOrder: 1 }],
  tools: [
    {
      id: 'tool-1', name: 'Burp Suite', type: 'exe',
      targetPath: 'C:\\burp\\burp.exe', categoryId: 'cat-1',
      icon: 'auto', pinned: true,
      runAsAdmin: true, confirmBeforeRun: false,
      runMode: 'window', runCount: 3, lastRunAt: '2026-09-29T01:57:00',
      sortOrder: 1, startHistory: ['2026-09-29T01:57:00']
    },
    {
      id: 'tool-2', name: '脚本A', type: 'bat',
      targetPath: 'D:\\测试 目录\\脚本 A.bat', categoryId: null,
      icon: 'auto', pinned: false,
      runAsAdmin: false, confirmBeforeRun: false,
      runMode: 'log', runCount: 1, lastRunAt: null, sortOrder: 2,
      showWindow: false, startHistory: []
    }
  ],
  settings: { theme: 'dark', closeToTray: true, sortMode: 'manual', showDock: true },
  combos: [{ id: 'combo-1', name: '组合', emoji: '⚡', toolIds: ['tool-1'], sortOrder: 1 }]
}

// 临时文件用于备份验证
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-migrate-'))
const cfgFile = path.join(tmpDir, 'tools.json')
fs.writeFileSync(cfgFile, JSON.stringify(v1Data, null, 2), 'utf-8')

console.log('\n[1] v1.3 → v2.0 迁移')
const { data: d1, migrated: m1 } = migrate(JSON.parse(JSON.stringify(v1Data)), cfgFile)
check('migrated = true', m1 === true)
check('version = 2.0', d1.version === '2.0')
check('备份文件 tools.json.bak 已生成', fs.existsSync(cfgFile + '.bak'))
check('旧分类保留', d1.categories.length === 1 && d1.categories[0].id === 'cat-1')
check('旧工具数量保留', d1.tools.length === 2)
check('工具1 生成 1 条 launchConfig', d1.tools[0].launchConfigs.length === 1)
check('默认配置名 = 默认启动', d1.tools[0].launchConfigs[0].name === '默认启动')
check('默认配置继承 runAsAdmin=true', d1.tools[0].launchConfigs[0].runAsAdmin === true)
check('默认配置继承 runMode=window', d1.tools[0].launchConfigs[0].runMode === 'window')
check('activeLaunchConfigId 指向默认配置', d1.tools[0].activeLaunchConfigId === d1.tools[0].launchConfigs[0].id)
check('工具2 showWindow=false → runMode=log', d1.tools[1].launchConfigs[0].runMode === 'log')
check('工具2 默认配置 showWindow=false', d1.tools[1].launchConfigs[0].showWindow === false)
check('工具2 默认配置 captureLog=true', d1.tools[1].launchConfigs[0].captureLog === true)
check('顶层旧字段保留(runAsAdmin)', d1.tools[0].runAsAdmin === true)
check('顶层旧字段保留(runMode)', d1.tools[0].runMode === 'window')
check('v2 骨架:workspaces 数组', Array.isArray(d1.workspaces))
check('v2 骨架:commands 数组', Array.isArray(d1.commands))
check('v2 骨架:resources 数组', Array.isArray(d1.resources))
check('v2 骨架:globalVars 对象', d1.globalVars && typeof d1.globalVars === 'object')
check('v2 骨架:proxy 结构', d1.proxy && Array.isArray(d1.proxy.profiles) && d1.proxy.current === null && d1.proxy.snapshot === null)
check('v2 骨架:sessions 数组', Array.isArray(d1.sessions))
check('v2 骨架:settings.defaultView = home', d1.settings.defaultView === 'home')
check('老 combos 数据不丢', Array.isArray(d1.combos) && d1.combos.length === 1)

console.log('\n[2] 幂等:已是 v2.0 再跑一遍')
const { data: d2, migrated: m2 } = migrate(JSON.parse(JSON.stringify(d1)), cfgFile)
check('migrated = false', m2 === false)
check('launchConfigs 不会被重复生成', d2.tools[0].launchConfigs.length === 1)
check('数据无损', JSON.stringify(d2.tools) === JSON.stringify(d1.tools))

console.log('\n[3] 新装(空数据)兜底')
const fresh = ensureV2Skeleton({ version: '2.0', categories: [], tools: [], settings: {} })
check('workspaces 骨架就位', Array.isArray(fresh.workspaces))
check('proxy 骨架就位', fresh.proxy.profiles.length === 0)
check('defaultView 默认 home', fresh.settings.defaultView === 'home')

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n结果:${pass} 通过,${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
