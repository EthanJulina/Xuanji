// ============================================================
// 玄机 - 高亮工具(搜索命中片段)
// 返回 [{ text, hit }] 供模板分段渲染
// ============================================================
export function highlight(text, kw) {
  if (!kw || !text) return [{ text: String(text || ''), hit: false }]
  const lower = String(text).toLowerCase()
  const idx = lower.indexOf(kw.toLowerCase())
  if (idx === -1) return [{ text: String(text), hit: false }]
  const out = []
  if (idx > 0) out.push({ text: String(text).slice(0, idx), hit: false })
  out.push({ text: String(text).slice(idx, idx + kw.length), hit: true })
  if (idx + kw.length < String(text).length) {
    out.push({ text: String(text).slice(idx + kw.length), hit: false })
  }
  return out
}
