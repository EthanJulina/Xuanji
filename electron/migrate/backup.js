// ============================================================
// 玄机 - 配置滚动备份
// tools.json.bak / .bak.1 / .bak.2 / .bak.3 三代轮换:
//   每次版本升级迁移前执行一次:
//     bak.3 ← bak.2 ← bak.1 ← bak ← 当前文件
//   保证最多保留 4 个历史版本(当前备份 + 三代),防止
//   连续多次升级把最早的可回退版本覆盖掉。
// ============================================================
const fs = require('fs')
const { log } = require('../logger')

// 返回值: { ok, rotated } ;失败不抛出(备份失败不阻塞迁移,仅记日志)
function rotateBackup(filePath) {
  try {
    // 从最老开始顺移
    if (fs.existsSync(filePath + '.bak.2')) {
      fs.copyFileSync(filePath + '.bak.2', filePath + '.bak.3')
    }
    if (fs.existsSync(filePath + '.bak.1')) {
      fs.copyFileSync(filePath + '.bak.1', filePath + '.bak.2')
    }
    if (fs.existsSync(filePath + '.bak')) {
      fs.copyFileSync(filePath + '.bak', filePath + '.bak.1')
    }
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak')
    }
    return { ok: true, rotated: true }
  } catch (e) {
    log('[backup] 滚动备份失败(继续迁移):' + e)
    return { ok: false, rotated: false }
  }
}

module.exports = { rotateBackup }
