// ============================================================
// 玄机 - 环境健康检查模块测试(纯 Node,mock electron)
// 覆盖:exec/port/file 三类检测 / 缓存与 force / CRUD / 引用清理
// 运行:node scripts/test-health.js
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name) }
  else { fail++; console.log('  ✘ ' + name) }
}
function section(n) { console.log('\n== ' + n + ' ==') }

/* ---- 环境:临时 tools.json + mock electron ---- */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-health-'))
const toolsJson = path.join(tmpDir, 'tools.json')

function writeDb(checks) {
  fs.writeFileSync(toolsJson, JSON.stringify({
    version: '2.1',
    categories: [], tools: [], workspaces: [], commands: [], resources: [],
    checks,
    settings: {
      theme: 'dark', closeToTray: true, sortMode: 'manual',
      run: { defaultCwd: '', dangerPatterns: [] },
      log: { errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 },
      healthCheck: { cacheTtlSec: 60, blockOnFail: true }
    }
  }))
}

// 起一个临时 TCP 服务供 port 检测(CJS 无顶层 await,端口在 main() 内取)
const tcpServer = net.createServer(() => {})
let tcpPort = 0

async function main() {
tcpPort = await new Promise((resolve) => {
  tcpServer.listen(0, '127.0.0.1', () => resolve(tcpServer.address().port))
})

const seedChecks = [
  { id: 'chk-echo', name: 'echo 输出', type: 'exec', command: 'echo hello-world', expectRegex: 'hello', timeoutMs: 5000, fixTip: 'fix echo' },
  { id: 'chk-fail', name: '必失败', type: 'exec', command: 'echo abc', expectRegex: 'xyz-not-exist', timeoutMs: 5000, fixTip: 'fix fail' },
  { id: 'chk-port-ok', name: '临时端口', type: 'port', host: '127.0.0.1', port: tcpPort, fixTip: '' },
  { id: 'chk-port-bad', name: '空闲端口', type: 'port', host: '127.0.0.1', port: 59999, fixTip: '' },
  { id: 'chk-file-ok', name: '存在文件', type: 'file', path: toolsJson, fixTip: '' },
  { id: 'chk-file-bad', name: '缺失文件', type: 'file', path: path.join(tmpDir, 'nope.txt'), fixTip: 'fix file' }
]
writeDb(seedChecks)

const Module = require('module')
const origLoad = Module._load
Module._load = function (request) {
  // beforeLaunch 段 require launcher → 连锁加载 runner → logstore:
  // logstore 顶层 app.getPath('userData') 建日志目录,runner 解构 app/shell,均需 mock
  if (request === 'electron') {
    return {
      app: { getPath: () => tmpDir },
      ipcMain: { handle() {} },
      shell: { openPath() {} }
    }
  }
  if (request === '../store') {
    return {
      load: () => JSON.parse(fs.readFileSync(toolsJson, 'utf-8')),
      save: (data) => fs.writeFileSync(toolsJson, JSON.stringify(data))
    }
  }
  if (request === '../logger') return { info() {}, warn() {}, error() {}, log() {} }
  return origLoad.apply(this, arguments)
}

const health = require('../electron/modules/health')

/* ---- 1. exec 检测 ---- */
section('exec 检测')
{
  const r = await health.runChecks(['chk-echo'], true)
  ok(r[0].ok === true && /hello/.test(r[0].message), `echo 输出命中 expectRegex(实际 ${r[0].message})`)
  ok(r[0].durationMs >= 0, '耗时已统计')

  const r2 = await health.runChecks(['chk-fail'], true)
  ok(r2[0].ok === false, 'expectRegex 不命中 → fail')
  ok(r2[0].fixTip === 'fix fail', 'fixTip 透传')
}

/* ---- 2. file 检测 ---- */
section('file 检测')
{
  const r = await health.runChecks(['chk-file-ok', 'chk-file-bad'], true)
  ok(r[0].ok === true, '存在的路径 → ok')
  ok(r[1].ok === false && /不存在/.test(r[1].message), '缺失路径 → fail')
}

/* ---- 3. port 检测 ---- */
section('port 检测')
{
  const r = await health.runChecks(['chk-port-ok', 'chk-port-bad'], true)
  ok(r[0].ok === true, `监听中的端口 → ok(实际 ${r[0].message})`)
  ok(r[1].ok === false, '空闲端口 → fail')
}

/* ---- 4. 缓存 ---- */
section('缓存与 force')
{
  const first = await health.runChecks(['chk-echo'], true)
  const second = await health.runChecks(['chk-echo'], false)
  ok(first[0].cached === false, 'force 首跑不走缓存')
  ok(second[0].cached === true, 'TTL 内复用缓存')
  // 修改模板后缓存失效
  const db = JSON.parse(fs.readFileSync(toolsJson, 'utf-8'))
  db.checks.find(c => c.id === 'chk-echo').expectRegex = 'no-match-now'
  fs.writeFileSync(toolsJson, JSON.stringify(db))
  health.invalidateCache()
  const third = await health.runChecks(['chk-echo'], false)
  ok(third[0].ok === false && third[0].cached === false, 'invalidateCache 后重新真实执行')
  // 还原
  const db2 = JSON.parse(fs.readFileSync(toolsJson, 'utf-8'))
  db2.checks.find(c => c.id === 'chk-echo').expectRegex = 'hello'
  fs.writeFileSync(toolsJson, JSON.stringify(db2))
}

/* ---- 5. 批量混合 ---- */
section('批量混合与未知 id')
{
  const r = await health.runChecks(['chk-echo', 'chk-not-exist-id'], true)
  ok(r.length === 1, '未知 checkId 被忽略(实际返回 ' + r.length + ' 项)')
  ok(r[0].checkId === 'chk-echo', '结果对应正确模板')
}

/* ---- 6. 启动拦截联动(beforeLaunch) ---- */
section('launcher.beforeLaunch 拦截')
{
  const launcher = require('../electron/modules/launcher')
  // 工具挂「必失败」+ blockOnFail=true → 拦截
  const db = JSON.parse(fs.readFileSync(toolsJson, 'utf-8'))
  db.settings.healthCheck.blockOnFail = true
  fs.writeFileSync(toolsJson, JSON.stringify(db))
  const blocked = await launcher.beforeLaunch({ id: 't1', name: '测试工具', checkIds: ['chk-fail'] }, null, false)
  ok(blocked.ok === false && blocked.blocked === true && blocked.results.length === 1, '红项 + blockOnFail → 拦截')

  // skipHealth = 强制跳过
  const skipped = await launcher.beforeLaunch({ id: 't1', name: '测试工具', checkIds: ['chk-fail'] }, null, true)
  ok(skipped.ok === true, 'skipHealth → 放行')

  // blockOnFail=false → 放行但带 warnings
  const db2 = JSON.parse(fs.readFileSync(toolsJson, 'utf-8'))
  db2.settings.healthCheck.blockOnFail = false
  fs.writeFileSync(toolsJson, JSON.stringify(db2))
  const warned = await launcher.beforeLaunch({ id: 't1', name: '测试工具', checkIds: ['chk-fail'] }, null, false)
  ok(warned.ok === true && warned.warnings.length === 1, 'blockOnFail=false → 放行并附 warnings')

  // 未挂检查 → 直接通过
  const none = await launcher.beforeLaunch({ id: 't1', name: '测试工具', checkIds: [] }, null, false)
  ok(none.ok === true && none.results.length === 0, '未挂检查 → 直接通过')
}

/* ---- 7. CRUD ---- */
section('模板 CRUD(经 IPC handler 注册验证省略,直接走模块逻辑)')
{
  // create 由 register 的 handler 完成;这里验证 runChecks 对新建模板的兼容
  writeDb([...seedChecks, { id: 'chk-custom', name: '自定义', type: 'file', path: toolsJson }])
  const r = await health.runChecks(['chk-custom'], true)
  ok(r[0].ok === true, '新增模板可被 runChecks 识别执行')
}

tcpServer.close()
console.log(`\n结果:${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
