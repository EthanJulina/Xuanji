const fs = require('fs')
const path = require('path')
const os = require('os')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-log-test-'))
const L = require(path.join(__dirname, '..', 'electron', 'logger.js'))

// 1) 追加验证:两次 boot,横幅都应保留
L.boot(dir, { ver: 'v1' })
L.shutdown('第一次退出')
L.boot(dir, { ver: 'v2' })
const afterBoot = fs.readFileSync(path.join(dir, 'app.log'), 'utf-8')
console.log('追加两次启动横幅:', (afterBoot.match(/新的一次启动/g) || []).length === 2 ? 'PASS' : 'FAIL')

// 2) 轮转验证:写满 5MB 触发轮转(MAX_SIZE = 5MB)
for (let i = 0; i < 50000; i++) L.info('bulk', 'x'.repeat(100))  // 约 6.8MB
const files1 = fs.readdirSync(dir).sort()
console.log('写满后文件:', files1.join(', '))
const appLog = fs.statSync(path.join(dir, 'app.log')).size
console.log('轮转后新 app.log 小于 5MB:', appLog < 5 * 1024 * 1024 ? 'PASS' : 'FAIL', '(' + appLog + 'B)')
console.log('历史 app.1.log 存在:', fs.existsSync(path.join(dir, 'app.1.log')) ? 'PASS' : 'FAIL')

// 3) 多次轮转:验证份数上限(最多 app.5.log,无 app.6.log)
for (let round = 0; round < 8; round++) for (let i = 0; i < 50000; i++) L.info('bulk', 'y'.repeat(100))
L.shutdown('测试退出')
const files2 = fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort()
console.log('最终文件:', files2.join(', '))
const nums = files2.filter(f => /^app\.\d+\.log$/.test(f)).map(f => +f.match(/app\.(\d+)\.log/)[1])
console.log('份数不超过 5 且编号连续:', (nums.length <= 5 && nums.every((n, i) => n === i + 1)) ? 'PASS' : 'FAIL')
let total = 0
for (const f of files2) total += fs.statSync(path.join(dir, f)).size
const totalMB = (total / 1024 / 1024).toFixed(1)
console.log('总占用 ' + totalMB + 'MB (上限约 30MB):', total < 31 * 1024 * 1024 ? 'PASS' : 'FAIL')
fs.rmSync(dir, { recursive: true, force: true })
console.log('--- 全部完成 ---')
