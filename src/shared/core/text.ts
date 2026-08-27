// 句末标点：句子在此结束
const TERMINAL = new Set(['。', '！', '？', '!', '?', '…'])
// 二级标点：断行/拆分时优先选择的断点
const SECONDARY = new Set(['，', '、', '；', '：', ',', ';', ':'])

export function isTerminalPunct(ch: string): boolean {
  return TERMINAL.has(ch)
}

export function isSecondaryPunct(ch: string): boolean {
  return SECONDARY.has(ch)
}

// 全角/中日韩字符宽度记 1，拉丁/半角记 0.5，空白记 0.5
export function charWidth(ch: string): number {
  if (/\s/.test(ch)) return 0.5
  const code = ch.codePointAt(0) ?? 0
  if (
    (code >= 0x2e80 && code <= 0x9fff) || // CJK 部首/汉字/日文假名等
    (code >= 0xf900 && code <= 0xfaff) || // 兼容表意文字
    (code >= 0xff00 && code <= 0xffef) || // 全角形式
    (code >= 0x3040 && code <= 0x30ff) // 假名
  ) {
    return 1
  }
  return 0.5
}

export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch)
  return w
}

export function trimInvisible(s: string): string {
  return s.replace(/^\s+|\s+$/g, '')
}

const ONLY_PUNCT_RE = /^[\s。，、；：！？,.;:!?;:"“”‘’"'（）()\[\]【】《》<>—–\-·…]+$/

export function isOnlyPunct(s: string): boolean {
  return s.length > 0 && ONLY_PUNCT_RE.test(s)
}
