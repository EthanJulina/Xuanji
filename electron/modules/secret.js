// ============================================================
// 玄机 - 敏感字段加密域(主进程模块)
// 职责:secret: 前缀 IPC —— Electron safeStorage(DPAPI)加解密
// 安全红线(需求第五节):
//   敏感字段(Proxy 凭据、标记为 secret 的变量等)必须加密落盘,
//   存储格式 { "encrypted": true, "value": "<base64>" },明文绝不落盘
// 说明:safeStorage 基于 Windows DPAPI,密钥绑定当前用户,
//       导出的配置在别的机器上无法解密(属预期安全行为)
// 本期(P0)仅提供能力与数据结构;Proxy(P2)/secret 变量(P1)
// 的业务 UI 未实现,未来接入时直接调用这里的接口。
// ============================================================
const { ipcMain, safeStorage } = require('electron')

// 明文 → 加密存储格式
// 返回 { encrypted: true, value: '<base64>' };失败返回 null(调用方应提示)
function encrypt(plainText) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const buf = safeStorage.encryptString(String(plainText))
    return { encrypted: true, value: buf.toString('base64') }
  } catch (_) {
    return null
  }
}

// 加密存储格式 → 明文
// 入参 { encrypted: true, value } 或普通字符串(视为未加密旧数据,原样返回)
function decrypt(box) {
  try {
    if (!box || typeof box !== 'object' || !box.encrypted) {
      return typeof box === 'string' ? box : ''
    }
    const buf = Buffer.from(box.value, 'base64')
    return safeStorage.decryptString(buf)
  } catch (_) {
    return ''   // 解密失败(跨机器导入等场景):返回空串,不抛异常
  }
}

// 是否为加密存储格式
function isEncrypted(box) {
  return !!(box && typeof box === 'object' && box.encrypted === true)
}

function register() {
  // 加密;返回加密盒或 { error }
  ipcMain.handle('secret:encrypt', (_e, plainText) => {
    const box = encrypt(plainText)
    if (!box) return { error: '加密不可用(safeStorage / DPAPI 未就绪)' }
    return box
  })
  // 解密;任何失败都返回空串,绝不抛出
  ipcMain.handle('secret:decrypt', (_e, box) => decrypt(box))
  // 加密能力探测(P1/P2 UI 接入前可先判断)
  ipcMain.handle('secret:available', () => {
    try { return safeStorage.isEncryptionAvailable() } catch (_) { return false }
  })
}

module.exports = { register, encrypt, decrypt, isEncrypted }
