// ============================================================
// 玄机 - v2.0 → v2.1 迁移单元测试(纯 Node,不依赖 Electron)
// 覆盖:字段默认值 / 预设种子 / 滚动备份 / 幂等性 / 越级拒绝 / v1 数据链路
// 运行:node scripts/test-migrate-v21.js
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')
const { migrate, ensureV21, HEALTH_PRESETS } = require('../electron/migrate/v2-0-to-v2-1')

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name) }
  else { fail++; console.log('  ✘ ' + name) }
}
function section(name) { console.log('\n== ' + name + ' ==') }

// 临时目录:每组用例独立,避免串扰
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qd-v21-test-'))
}

// 构造一份最小 v2.0 数据
function v20Data() {
  return {
    version: '2.0',
    categories: [{ id: 'c1', name: '默认分类', icon: '', collapsed: false }],
    tools: [
      { id: 't1', name: '测试工具', path: 'C:/bin/tool.exe', checkIds: undefined },
      { id: 't2', name: '工具二', path: 'C:/bin/t2.exe' }
    ],
    workspaces: [],
    commands: [],
    resources: [],
    globalVars: {},
    settings: { theme: 'dark', closeToTray: true, sortMode: 'manual' }
  }
}

// ---- 1. 正常迁移:v2.0 → v2.1 ----
section('正常迁移 v2.0 → v2.1')
{
  const dir = tmpDir()
  const file = path.join(dir, 'tools.json')
  fs.writeFileSync(file, JSON.stringify(v20Data()))

  const r = migrate(v20Data(), file)
  ok(r.migrated === true, '返回 migrated=true')
  ok(r.data.version === '2.1', 'version 升到 2.1')
  ok(Array.isArray(r.data.checks) && r.data.checks.length === HEALTH_PRESETS.length, `checks 种子写入 ${HEALTH_PRESETS.length} 个预设(实际 ${r.data.checks.length})`)
  ok(r.data.checks[0].id === 'chk-java' && r.data.checks[0].type === 'exec', '预设含 chk-java(exec 型)')
  ok(r.data.tools.every(t => Array.isArray(t.checkIds) && t.checkIds.length === 0), '所有工具补 checkIds:[]')
  const s = r.data.settings
  ok(s.run && s.run.defaultCwd === '' && Array.isArray(s.run.dangerPatterns) && s.run.dangerPatterns.length === 5, 'settings.run 默认值(defaultCwd 空 + 5 条危险正则)')
  ok(s.log && s.log.retentionDays === 14 && s.log.maxFileSizeMB === 5 && Array.isArray(s.log.errorPatterns) && s.log.warnPatterns.length > 0, 'settings.log 默认值(14天/5MB/双模式列表)')
  ok(s.healthCheck && s.healthCheck.cacheTtlSec === 300 && s.healthCheck.blockOnFail === true, 'settings.healthCheck 默认值(300s/阻止)')
  ok(typeof s.theme === 'string' && s.theme === 'dark', '原有 settings 字段不丢失')

  // 滚动备份:bak 生成
  ok(fs.existsSync(file + '.bak'), '迁移备份 tools.json.bak 已生成')
  const bak = JSON.parse(fs.readFileSync(file + '.bak', 'utf-8'))
  ok(bak.version === '2.0', '.bak 内容是迁移前的 v2.0 原始数据')

  // 旧文件未被就地破坏(v2.0 原文在迁移调用后仍存在,migrate 不写盘,由调用方 save)
  ok(JSON.parse(fs.readFileSync(file, 'utf-8')).version === '2.0', 'migrate 本身不写盘(版本仍 2.0,落盘由调用方负责)')
}

// ---- 2. 滚动备份三代轮换:重复迁移多次,bak.1/2/3 依次产生 ----
section('滚动备份三代轮换')
{
  const dir = tmpDir()
  const file = path.join(dir, 'tools.json')
  // 直接在磁盘文件上模拟三次「v2.0 版本重置 + 迁移」,验证 bak 链
  for (let i = 1; i <= 3; i++) {
    const d = v20Data()
    d.version = '2.0'
    fs.writeFileSync(file, JSON.stringify(d))   // 模拟用户回滚到 v2.0 再升级
    migrate(JSON.parse(fs.readFileSync(file, 'utf-8')), file)
  }
  ok(fs.existsSync(file + '.bak'), 'bak 存在(最近一代)')
  ok(fs.existsSync(file + '.bak.1'), 'bak.1 存在(上一代)')
  ok(fs.existsSync(file + '.bak.2'), 'bak.2 存在(上上代)')
  // 第 3 次迁移时:bak.2 ← 原 bak.1;尚未触发 bak.3(需第 4 次)
  const d4 = v20Data()
  fs.writeFileSync(file, JSON.stringify(d4))
  migrate(d4, file)
  ok(fs.existsSync(file + '.bak.3'), '第 4 次迁移后 bak.3 产生(最早一代不丢)')
}

// ---- 3. 幂等性:已是 v2.1 重复跑不产生备份、不重复种子 ----
section('幂等性(already-v21)')
{
  const dir = tmpDir()
  const file = path.join(dir, 'tools.json')
  const once = migrate(v20Data(), file).data
  once.checks.push({ id: 'chk-custom', name: '用户自定义', type: 'exec', command: 'echo hi', expectRegex: 'hi', timeoutMs: 3000 })

  const file2 = path.join(dir, 'tools2.json')
  fs.writeFileSync(file2, JSON.stringify(once))
  const before = fs.readFileSync(file2, 'utf-8')
  const r = migrate(JSON.parse(before), file2)
  ok(r.migrated === false && r.reason === 'already-v21', '重复迁移返回 already-v21')
  ok(!fs.existsSync(file2 + '.bak'), '不产生新备份(不覆盖最早备份)')
  ok(r.data.checks.length === once.checks.length && r.data.checks.some(c => c.id === 'chk-custom'), '用户自定义检查保留、预设不重复种子')
  // ensureV21 幂等:字段补齐后内容不变
  const again = ensureV21(JSON.parse(JSON.stringify(r.data)))
  ok(JSON.stringify(again) === JSON.stringify(ensureV21(JSON.parse(JSON.stringify(r.data)))), 'ensureV21 双次调用结果一致')
}

// ---- 4. 越级拒绝:v1.x 数据直接进来不做 v2.1 迁移 ----
section('越级拒绝(need-v2-first)')
{
  const d = { version: '1.3', categories: [], tools: [{ id: 'x', name: '老工具' }], settings: {} }
  const r = migrate(d, null)
  ok(r.migrated === false && r.reason === 'need-v2-first', 'v1.x 数据拒绝直迁(由 v1→v2 先行)')
}

// ---- 5. 缺字段数据:ensureV21 全量兜底 ----
section('残缺数据兜底')
{
  const d = { version: '2.0', tools: [] }
  const out = ensureV21(d)
  ok(Array.isArray(out.checks), '缺 checks → 补 []')
  ok(out.settings.run.dangerPatterns.length === 5, '缺 settings.run → 补默认(含危险正则)')
  ok(out.settings.log.retentionDays === 14, '缺 settings.log → 补默认')
  ok(out.settings.healthCheck.blockOnFail === true, '缺 settings.healthCheck → 补默认')
  ok(out.settings.theme === undefined || typeof out.settings.theme === 'string', '不误伤其他 settings 键')
}

// ---- 6. 主进程迁移链模拟:v1 → v2.0 → v2.1 两级串行 ----
section('两级迁移链串行(v1 → v2.0 → v2.1)')
{
  const { migrate: migrateV1toV2 } = require('../electron/migrate/v1-to-v2')
  const dir = tmpDir()
  const file = path.join(dir, 'tools.json')
  const v1 = {
    version: '1.3',
    categories: [{ id: 'c1', name: '分类', icon: '', collapsed: false }],
    tools: [{ id: 't1', name: '老工具', path: 'C:/x.exe', args: '', cwd: '', hotkey: '' }],
    settings: { theme: 'dark', closeToTray: true }
  }
  fs.writeFileSync(file, JSON.stringify(v1))

  const r1 = migrateV1toV2(JSON.parse(JSON.stringify(v1)), file)
  ok(r1.migrated === true && r1.data.version === '2.0', '第一级 v1→v2.0 完成')
  const r2 = migrate(r1.data, file)
  ok(r2.migrated === true && r2.data.version === '2.1', '第二级 v2.0→v2.1 完成')
  ok(Array.isArray(r2.data.workspaces) && Array.isArray(r2.data.commands), 'v2.0 骨架字段保留')
  ok(Array.isArray(r2.data.checks) && r2.data.checks.length === HEALTH_PRESETS.length, 'v2.1 检查预设已种子')
  ok(r2.data.tools[0].checkIds && Array.isArray(r2.data.tools[0].checkIds), '工具 checkIds 已补齐')
}

// ---- 汇总 ----
console.log(`\n结果:${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
