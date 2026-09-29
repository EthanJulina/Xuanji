// ============================================================
// 玄机 - 拼音首字母工具(P1)
// 基于 pinyin-pro(纯本地库,运行时不联网)
// ============================================================
import { pinyin } from 'pinyin-pro'

const cache = new Map()

// 取「拼音首字母串」,如「一键清理缓存」→ "yjqlhc";非中文字符原样小写
export function initialism(text) {
  if (!text) return ''
  if (cache.has(text)) return cache.get(text)
  let result = ''
  try {
    result = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('').replace(/[^a-z0-9]/gi, '').toLowerCase()
  } catch (_) {
    result = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  }
  cache.set(text, result)
  return result
}
