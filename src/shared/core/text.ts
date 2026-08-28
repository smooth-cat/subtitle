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

// 全角/中日韩字符宽度记 1，拉丁/半角记 0.5；空白（空格等）不计宽——不占每行字数上限
export function charWidth(ch: string): number {
  if (/\s/.test(ch)) return 0
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

// ─── 盘古空格：CJK 与英文/数字相邻处补一个半角空格 ─────────────
// CJK 取汉字/假名（不含全角标点）——与全角标点相邻处不加空格
const CJK_CLASS = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
// 英文/数字短语：字母数字连续段整体不拆，内部连接符（' - . + / &）允许符号连跑（如 c++11），
// 结尾符号段（+ # * % °）整体收尾（如 c++、C#、50%）
const PHRASE_SRC = "[A-Za-z0-9]+(?:['\\-.+/&]+[A-Za-z0-9]+)*(?:[+#*%°]+)?"
const RE_CJK_THEN_PHRASE = new RegExp(`([${CJK_CLASS}])(${PHRASE_SRC})`, 'g')
const RE_PHRASE_THEN_CJK = new RegExp(`(${PHRASE_SRC})([${CJK_CLASS}])`, 'g')

// 单行补空格：只在 CJK 汉字与英文/数字短语直接相邻处插入；
// 短语内部原有空格（如 hello world 1）不额外加，已有空格不重复，行首尾不加。幂等。
export function padLatinSpacing(line: string): string {
  return line.replace(RE_CJK_THEN_PHRASE, '$1 $2').replace(RE_PHRASE_THEN_CJK, '$1 $2')
}

// 整条字幕文本（行间 \n）逐行补空格；enabled=false 原样返回
export function padCueText(text: string, enabled: boolean): string {
  if (!enabled) return text
  return text
    .split('\n')
    .map((l) => padLatinSpacing(l))
    .join('\n')
}
