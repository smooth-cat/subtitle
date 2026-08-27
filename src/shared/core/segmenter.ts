// 词边界切分：Electron / Node 自带 ICU 的 Intl.Segmenter，零额外依赖
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })

export interface WordUnit {
  text: string
  start: number // 在原字符串中的偏移（含）
  end: number // 偏移（不含）
}

const PUNCT_RE = /^[，。、；：！？,.;:!?;:"“”‘’"'（）()\[\]【】《》<>—–·…]+$/

// 把字符串切成词单元；标点吸附到前一个词（断行断点自然落在标点之后），
// 空白吸附到前一个词（保留原文空格）。
export function splitWords(text: string): WordUnit[] {
  const units: WordUnit[] = []
  for (const seg of segmenter.segment(text)) {
    const s = seg.index
    const e = seg.index + seg.segment.length
    const last = units[units.length - 1]
    if (!seg.segment.trim()) {
      if (last) {
        last.text += seg.segment
        last.end = e
      } else {
        units.push({ text: seg.segment, start: s, end: e })
      }
      continue
    }
    if (!seg.isWordLike && PUNCT_RE.test(seg.segment) && last) {
      last.text += seg.segment
      last.end = e
      continue
    }
    units.push({ text: seg.segment, start: s, end: e })
  }
  return units
}
