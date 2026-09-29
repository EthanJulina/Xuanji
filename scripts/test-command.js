// ============================================================
// 玄机 - Command Vault 测试(纯 Node)
// A 部分:变量渲染器(从 commandStore.js 源码截取纯函数段)
//   覆盖:{{var}} 提取 / 渲染 / 优先级 workspace > globalVars > ask
// B 部分:主进程 command.js(mock electron + store)
//   覆盖:CRUD / 危险命令兜底拦截 / 确认后放行 / 统计更新
// 运行:node scripts/test-command.js
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')

let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name) }
  else { fail++; console.log('  ✘ ' + name) }
}
function section(n) { console.log('\n== ' + n + ' ==') }

/* ================= A. 变量渲染器 ================= */
section('变量渲染器(extractVars / renderTemplate / resolveSources)')
{
  const src = fs.readFileSync(path.join(__dirname, '../src/stores/commandStore.js'), 'utf-8')
  // 截取纯函数段:VAR_RE 定义到「命令 CRUD」注释前(不含依赖 s/qd 的 CRUD 段)
  const start = src.indexOf('const VAR_RE')
  const end = src.indexOf('/* ---------------- 命令 CRUD')
  const seg = src.slice(start, end)
    // 剥离 ESM 导出前缀(new Function 是 CJS 环境)
    .replace(/export function/g, 'function')
    .replace(/export const/g, 'const')
  // 提供 resolveSources 依赖:局部注入 s / workspaceById
  const fakeS = {
    view: { type: 'workspace', id: 'ws-1' },
    data: { globalVars: { token: 'gl-token', host: 'gl-host' } }
  }
  const fakeWs = {
    'ws-1': { vars: { host: 'ws-host', port: '8080' } },
    'ws-2': { vars: {} }
  }
  const injected = `
    const s = ${JSON.stringify({ view: fakeS.view, data: fakeS.data })};
    const WS_MAP = ${JSON.stringify(fakeWs)};
    const workspaceById = (id) => WS_MAP[id] || null;
  `
  const mod = new Function(injected + seg + `
    return { extractVars, resolveSources, renderTemplate, previewRender };
  `)()

  // 提取
  const vars = mod.extractVars('nmap -p {{ports}} {{target}} {{ ports }} {{ports}}')
  ok(JSON.stringify(vars) === '["ports","target"]', `提取变量去重且容忍空格(实际 ${JSON.stringify(vars)})`)
  ok(mod.extractVars('no vars here').length === 0, '无变量返回空')
  ok(mod.extractVars('{{123bad}} {{good_1.x}}').join(',') === 'good_1.x', '非法起始字符的变量被忽略,支持点号 key')

  // 渲染
  const r1 = mod.renderTemplate('curl {{host}}:{{port}}/x', { host: 'a.com', port: '80' })
  ok(r1.text === 'curl a.com:80/x' && r1.missing.length === 0, '全量渲染成功')
  const r2 = mod.renderTemplate('curl {{host}}:{{port}}/x', { host: 'a.com' })
  ok(r2.text === 'curl a.com:{{port}}/x' && r2.missing.join() === 'port', '缺变量保留原文并记录 missing')

  // 优先级:workspace > globalVars > ask
  const src1 = mod.resolveSources('http://{{host}}:{{port}}/{{path}}')
  ok(src1.host.source === 'workspace' && src1.host.value === 'ws-host', 'host:空间变量优先于全局')
  ok(src1.port.source === 'workspace' && src1.port.value === '8080', 'port:仅空间有 → workspace')
  ok(src1.path.source === 'ask', 'path:无来源 → ask')

  // 全局回落
  const fakeS2 = { view: { type: 'workspace', id: 'ws-2' }, data: fakeS.data }
  const mod2 = new Function(`
    const s = ${JSON.stringify(fakeS2)};
    const WS_MAP = ${JSON.stringify(fakeWs)};
    const workspaceById = (id) => WS_MAP[id] || null;
  ` + seg + `return { resolveSources };`)()
  const src2 = mod2.resolveSources('http://{{host}}:{{port}}')
  ok(src2.host.source === 'global' && src2.host.value === 'gl-host', '空间无此变量 → 回落 globalVars(gl-host)')
  ok(src2.port.source === 'ask', '两者都无 → ask')

  // 不在空间:workspace 来源回落
  const fakeS3 = { view: { type: 'home', id: null }, data: fakeS.data }
  const mod3 = new Function(`
    const s = ${JSON.stringify(fakeS3)};
    const WS_MAP = ${JSON.stringify(fakeWs)};
    const workspaceById = (id) => WS_MAP[id] || null;
  ` + seg + `return { resolveSources, previewRender };`)()
  const src3 = mod3.resolveSources('http://{{host}}')
  ok(src3.host.source === 'global', '不在工作空间视图 → workspace 来源回落 global(不取 ws-1 的值)')
  ok(src3.host.value === 'gl-host', '回落值正确(未误取空间变量 ws-host)')

  // 预览渲染:ask 用填写值,未填保持占位
  const pv = mod3.previewRender('curl -H "B: {{token}}" {{target}}', { target: '1.2.3.4' })
  ok(pv.text === 'curl -H "B: gl-token" 1.2.3.4', '预览:global 自动注入 + ask 用填写值')
  const pv2 = mod3.previewRender('ping {{target}}', {})
  ok(pv2.text === 'ping {{target}}' && pv2.missing.join() === 'target', '预览:ask 未填保留占位并报 missing')
}

/* ================= B. 主进程 command.js ================= */
section('主进程 command.js(CRUD / 危险兜底)')
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-command-'))
  const toolsJson = path.join(tmpDir, 'tools.json')
  // 初始 v2.1 数据(含危险正则)
  fs.writeFileSync(toolsJson, JSON.stringify({
    version: '2.1',
    categories: [], tools: [], workspaces: [], commands: [],
    settings: {
      theme: 'dark', closeToTray: true, sortMode: 'manual',
      run: { defaultCwd: '', dangerPatterns: ['rm\\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)', '\\bdel\\b'] },
      log: { errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 },
      healthCheck: { cacheTtlSec: 300, blockOnFail: true }
    }
  }))

  const handlers = {}
  const Module = require('module')
  const origLoad = Module._load
  let runCalls = []
  Module._load = function (request) {
    if (request === 'electron') {
      return { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn } } }
    }
    if (request === '../store') {
      return {
        load: () => JSON.parse(fs.readFileSync(toolsJson, 'utf-8')),
        save: (data) => fs.writeFileSync(toolsJson, JSON.stringify(data))
      }
    }
    if (request === '../logger') {
      return { info() {}, warn() {}, error() {}, log() {} }
    }
    if (request === '../runner') {
      return { runCmd: (id, name, rendered, cwd) => { runCalls.push({ id, name, rendered, cwd }); return { ok: true, pid: 4321 } } }
    }
    return origLoad.apply(this, arguments)
  }
  require('../electron/modules/command').register()

  // create
  const cmd = handlers['command:create'](null, { name: '清理日志', template: 'del /q {{file}}', tags: ['维护'] })
  ok(cmd.id.startsWith('cmd-') && cmd.template === 'del /q {{file}}', 'create 生成 id 与字段')
  ok(cmd.varMemory && cmd.runCount === 0, 'create 初始化 varMemory 与统计')

  // update(varMemory 持久化)
  handlers['command:update'](null, { id: cmd.id, patch: { varMemory: { file: 'C:/a.log' }, favorite: true } })
  const afterUpd = JSON.parse(fs.readFileSync(toolsJson, 'utf-8')).commands[0]
  ok(afterUpd.varMemory.file === 'C:/a.log' && afterUpd.favorite === true, 'update 持久化 varMemory 与收藏')

  // run:危险命令未确认 → 拒绝
  const blocked = handlers['command:run'](null, { id: cmd.id, name: '清理日志', rendered: 'del /q C:/a.log', confirmedDanger: false })
  ok(blocked.ok === false && blocked.error === 'danger-blocked', '危险命令未确认被拒(danger-blocked)')
  ok(runCalls.length === 0, 'runner.runCmd 未被调用')

  // run:确认后放行
  const allowed = handlers['command:run'](null, { id: cmd.id, name: '清理日志', rendered: 'del /q C:/a.log', confirmedDanger: true })
  ok(allowed.ok === true && allowed.pid === 4321, '确认后放行并返回 pid')
  ok(runCalls.length === 1 && runCalls[0].rendered === 'del /q C:/a.log', 'runCmd 收到渲染结果')

  // run:普通命令无需确认
  const normal = handlers['command:run'](null, { id: cmd.id, name: '查看目录', rendered: 'dir C:/' })
  ok(normal.ok === true, '普通命令直接放行')

  // 统计更新(danger-blocked 的那次被提前拒绝,不计入)
  const afterRun = JSON.parse(fs.readFileSync(toolsJson, 'utf-8')).commands[0]
  ok(afterRun.runCount === 2, `runCount 只累计放行的 2 次(实际 ${afterRun.runCount})`)
  ok(!!afterRun.lastRunAt, 'lastRunAt 已记录')

  // delete
  handlers['command:delete'](null, cmd.id)
  ok(JSON.parse(fs.readFileSync(toolsJson, 'utf-8')).commands.length === 0, 'delete 移除命令')

  Module._load = origLoad
}

// ---- 汇总 ----
console.log(`\n结果:${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
