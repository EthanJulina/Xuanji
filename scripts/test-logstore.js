// ============================================================
// 玄机 - logstore 日志中心单元测试(纯 Node,mock electron)
// 覆盖:等级判定 / 落盘回读 / 轮转 / 清空 / 导出格式 / 过期清理 / 列表统计
// 运行:node scripts/test-logstore.js
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

// ---- mock electron(app.getPath / ipcMain / shell)----
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-logstore-'))
const Module = require('module')
const origLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') {
    return {
      app: { getPath: () => tmpDir },
      ipcMain: { handle: () => {} },
      shell: { openPath: () => {} }
    }
  }
  return origLoad.apply(this, arguments)
}

const logstore = require('../electron/modules/logstore')
const logsDir = path.join(tmpDir, 'logs')

// ---- 1. 配置注入 + 等级判定 ----
section('等级判定 classify')
logstore.configure({
  errorPatterns: ['\\berror\\b', 'fatal', '失败'],
  warnPatterns: ['\\bwarn', '警告'],
  retentionDays: 14,
  maxFileSizeMB: 5
})
ok(logstore.classify('something bad', 'error') === 'error', '显式 error 保留')
ok(logstore.classify('be careful', 'warning') === 'warning', '显式 warning 保留')
ok(logstore.classify('done ok', 'success') === 'success', 'success 不重判(正常退出)')
ok(logstore.classify('ERROR: disk full', 'info') === 'error', 'info 命中 errorPatterns → error')
ok(logstore.classify('警告: 低磁盘', 'info') === 'warning', 'info 命中 warnPatterns → warning')
ok(logstore.classify('this is a [WARNING] test', 'info') === 'warning', '\\bwarn 词边界命中 [WARNING]')
ok(logstore.classify('plain output line', 'info') === 'info', '不命中保持 info')
ok(logstore.classify('this is ERROR and also 警告 both', 'info') === 'error', '双命中优先 error')
ok(logstore.classify('[invalid regex ( here', 'info') === 'info', '非法正则行被忽略不炸')

// ---- 2. 落盘 + 回读 ----
section('落盘与回读')
logstore.append('tool-a', 'normal line 1', 'info')
logstore.append('tool-a', 'ERROR happened', 'info')       // 判定为 error
logstore.append('tool-a', 'stderr text', 'error')          // 显式 error
const rows = logstore.read('tool-a', 100)
ok(rows.length === 3, `回读 3 行(实际 ${rows.length})`)
ok(rows[0].text === 'normal line 1' && rows[0].lvl === 'info', '第 1 行内容与等级一致')
ok(rows[1].lvl === 'error', '模式判定行落盘为 error')
ok(typeof rows[0].t === 'string' && !isNaN(Date.parse(rows[0].t)), '时间戳为合法 ISO')

// ---- 3. 轮转 ----
section('轮转')
logstore.configure({ errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 0.000001 })  // 极小阈值
logstore.append('tool-a', 'this line triggers rotation', 'info')
ok(fs.existsSync(path.join(logsDir, 'tool-a.1.jsonl')), '超限后 .1.jsonl 历史文件产生')
ok(fs.existsSync(path.join(logsDir, 'tool-a.jsonl')), '当前文件继续写入')
// 再次轮转:旧 .1 被顶掉(仅保留一代)
logstore.append('tool-a', 'second rotation trigger', 'info')
ok(fs.existsSync(path.join(logsDir, 'tool-a.1.jsonl')), '二次轮转正常(单代保留)')

// ---- 4. 列表统计 ----
section('列表统计 listTools')
const list = logstore.listTools()
const a = list.find(x => x.toolId === 'tool-a')
ok(!!a, 'tool-a 出现在列表')
// 单代保留语义:二次轮转顶掉第一代 .1 历史,仅剩第二代 .1(1 行 info)+ 当前(1 行 info)
ok(a.lines === 2, `行数统计与磁盘一致 =2(实际 ${a.lines})`)
ok(a.errors === 0, '错误计数与单代存留一致(含 error 的第一代历史已被顶掉)')
ok(a.lastAt > 0, 'lastAt 已记录')

// ---- 5. 导出格式 ----
section('导出 exportText')
const text = logstore.exportText('tool-a')
ok(Array.isArray(text) && text.length === a.lines, `导出行数与统计一致(实际 ${text.length})`)
ok(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[(INFO|WARNING|ERROR|SUCCESS)\] /.test(text[0]), '导出行格式 [时间] [等级] 文本')

// ---- 6. 过期清理 ----
section('过期清理 maintenance')
logstore.configure({ errorPatterns: [], warnPatterns: [], retentionDays: 14, maxFileSizeMB: 5 })
logstore.append('tool-old', 'old log', 'info')
// 伪造 20 天前的 mtime
const oldFile = path.join(logsDir, 'tool-old.jsonl')
const past = new Date(Date.now() - 20 * 24 * 3600 * 1000)
fs.utimesSync(oldFile, past, past)
const removed = logstore.maintenance()
ok(removed >= 1, `清理至少 1 个过期文件(实际 ${removed})`)
ok(!fs.existsSync(oldFile), '过期文件已删除')
ok(fs.existsSync(path.join(logsDir, 'tool-a.jsonl')), '未过期文件保留')

// ---- 7. 清空 ----
section('清空 clear')
logstore.append('tool-b', 'to be cleared', 'info')
ok(logstore.read('tool-b', 10).length === 1, 'tool-b 写入成功')
logstore.clear('tool-b')
ok(logstore.read('tool-b', 10).length === 0, '清空后回读为空')
ok(!fs.existsSync(path.join(logsDir, 'tool-b.jsonl')), 'jsonl 文件已删除')

// ---- 汇总 ----
console.log(`\n结果:${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
