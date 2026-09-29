// ============================================================
// 玄机 - 图标层
// app.getFileIcon 获取 .lnk/.exe 的系统真实图标,
// 转 dataURL 后缓存到 userData/icons/{toolId}.png,避免重复获取
// v2.2.0 修复「图标丢失」:
//   1. .lnk 先解析真实目标(shell.readShortcutLink),对目标提取 ——
//      直接对 lnk 提取会拿到「白纸+蓝箭头」通用快捷方式图标
//   2. 路径先 normalize(历史数据存在 C://// 四连斜杠脏路径)
//   3. 空图(isEmpty/过小)不落缓存,失败返回 null 用首字母占位
//   4. 默认图指纹黑名单:悬空/损坏的 lnk(readShortcutLink 抛异常)与
//      无效路径会让 shell 返回同一张「通用白框图」—— 预先对不存在的
//      路径提取一次取得指纹,提取结果命中指纹即视为失败(不缓存、
//      磁盘旧缓存命中指纹也视为坏图重新提取,老坏缓存自动自愈)
// ============================================================
const { app, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { iconDir } = require('./store')

const memCache = new Map() // toolId → dataURL 内存缓存

/* ---------------- 通用默认图指纹 ---------------- */
let defaultIconHash = null
async function getDefaultIconHash() {
  if (defaultIconHash !== null) return defaultIconHash
  try {
    const icon = await app.getFileIcon('Z:\\__qd_no_such_file__.lnk', { size: 'large' })
    defaultIconHash = crypto.createHash('md5').update(icon.toPNG()).digest('hex')
  } catch (_) { defaultIconHash = '' }
  return defaultIconHash
}
function isDefaultIcon(png) {
  if (!defaultIconHash) return false
  return crypto.createHash('md5').update(png).digest('hex') === defaultIconHash
}

// 提取单一路径的图标并写磁盘缓存;空图/默认白框图/异常返回 null(内存缓存由调用方写)
async function extractTo(targetPath, cacheFile) {
  const icon = await app.getFileIcon(targetPath, { size: 'large' }) // 32x32
  const png = icon.toPNG()
  // 空图/异常小图/通用默认图不缓存(否则坏图会因「缓存存在」永久存续)
  if (!png || png.length < 128 || icon.isEmpty() || isDefaultIcon(png)) return null
  fs.writeFileSync(cacheFile, png)
  return 'data:image/png;base64,' + png.toString('base64')
}

// 获取工具图标 dataURL;失败返回 null(前端用首字母占位图)
async function getIcon(toolId, targetPath) {
  if (!toolId) return null
  await getDefaultIconHash() // 懒初始化指纹
  // 1. 内存缓存
  if (memCache.has(toolId)) return memCache.get(toolId)
  // 2. 磁盘缓存(命中默认图指纹视为坏图,忽略并重新提取 —— 修复历史坏缓存)
  const cacheFile = path.join(iconDir, `${toolId}.png`)
  try {
    if (fs.existsSync(cacheFile)) {
      const raw = fs.readFileSync(cacheFile)
      if (!isDefaultIcon(raw)) {
        const dataUrl = 'data:image/png;base64,' + raw.toString('base64')
        memCache.set(toolId, dataUrl)
        return dataUrl
      }
      // 坏缓存:删除,走重新提取
      try { fs.rmSync(cacheFile, { force: true }) } catch (_) {}
    }
  } catch (_) {}
  // 3. 系统真实图标(仅对存在文件;路径先清洗)
  if (!targetPath) return null
  const clean = path.normalize(String(targetPath))
  if (!fs.existsSync(clean)) return null
  // 候选提取路径:lnk 解析真实目标;悬空/损坏的 lnk 不再回落对 lnk 本身提取
  // (必然拿到通用白框图,对用户是误导,不如首字母占位)
  const candidates = []
  if (/\.lnk$/i.test(clean)) {
    let link = null
    try { link = shell.readShortcutLink(clean) } catch (_) {}
    if (link && link.target && fs.existsSync(link.target)) {
      candidates.push(link.target)
      if (link.iconLocation) {
        const ic = path.normalize(String(link.iconLocation).replace(/,\d+$/, ''))
        if (fs.existsSync(ic)) candidates.push(ic) // 图标资源文件兜底
      }
    }
    // link 为 null(损坏)或 target 不存在(悬空):不加 lnk 本身
  } else {
    candidates.push(clean)
  }
  for (const p of candidates) {
    try {
      const dataUrl = await extractTo(p, cacheFile)
      if (dataUrl) { memCache.set(toolId, dataUrl); return dataUrl }
    } catch (_) {}
  }
  return null
}

// 删除工具时清理图标缓存
function removeIcon(toolId) {
  memCache.delete(toolId)
  try { fs.rmSync(path.join(iconDir, `${toolId}.png`), { force: true }) } catch (_) {}
}

module.exports = { getIcon, removeIcon }
