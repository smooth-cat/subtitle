import type { Token } from '../types'
import { isOnlyPunct, isTerminalPunct, trimInvisible } from './text'

export interface Sentence {
  text: string // 完整句子文本（跨多个 whisper segment 重建）
  start: number
  end: number
  tokens: Token[]
  tokenStart: number // 在全量 tokens 中的下标（含）
  tokenEnd: number // 下标（不含）
}

// 跨段合并成句：累积 token 直到句末标点（。？！?!…），重建完整句子
export function buildSentences(tokens: Token[]): Sentence[] {
  const out: Sentence[] = []
  let startIdx = 0
  const flush = (endIdx: number) => {
    const slice = tokens.slice(startIdx, endIdx)
    const text = slice.map((t) => t.text).join('')
    if (!trimInvisible(text)) {
      startIdx = endIdx
      return
    }
    // 只有标点/空白的“句子”并入前一句，避免出现纯标点字幕条
    if (isOnlyPunct(text) && out.length > 0) {
      const prev = out[out.length - 1]
      prev.text += text
      prev.end = slice[slice.length - 1].end
      prev.tokenEnd = endIdx
      startIdx = endIdx
      return
    }
    out.push({
      text,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      tokens: slice,
      tokenStart: startIdx,
      tokenEnd: endIdx
    })
    startIdx = endIdx
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const lastChar = trimInvisible(t.text).slice(-1)
    if (isTerminalPunct(lastChar) || i === tokens.length - 1) {
      flush(i + 1)
    }
  }
  return out
}
