// ============================================================
// 玄机 - 主进程桥(供 runner 等模块获取窗口列表推送事件)
// ============================================================
let win = null

function setWindow(w) { win = w }
function windows() { return win && !win.isDestroyed() ? [win] : [] }

module.exports = { setWindow, windows }
