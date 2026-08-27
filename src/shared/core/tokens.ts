import type { RawSegment, Token } from '../types'
import { isTerminalPunct, textWidth } from './text'
import { splitWords } from './segmenter'

export interface WhisperJsonFull {
  result?: { language?: string }
  transcription?: Array<{
    offsets?: { from?: number; to?: number }
    text?: string
    tokens?: unknown[]
  }>
}

// 去掉 whisper 输出中的特殊标记：[_TT_]、<|zh|> 等
function cleanText(t: string): string {
  return t.replace(/<\|[^|]*\|>/g, '').replace(/\[_?[A-Z_]+\]/g, '')
}

// 解析 whisper.cpp json-full 输出 → 原始分段列表
export function parseWhisperJson(json: WhisperJsonFull): RawSegment[] {
  const out: RawSegment[] = []
  for (const seg of json.transcription ?? []) {
    const text = cleanText(seg.text ?? '')
    if (!text.trim()) continue
    const from = Math.max(0, Math.round(seg.offsets?.from ?? 0))
    const to = Math.max(from + 20, Math.round(seg.offsets?.to ?? from))
    out.push({ text, start: from, end: to })
  }
  return out
}

// 原始分段 → 词级 token。
// - 分段本身已是词级（-ml 1 -sow 生效）时，直接使用真实时间戳；
// - 分段过粗（如中文整段无空格）时，在段内按词单元切分并用字符占比插值兜底。
export function rawToTokens(raw: RawSegment[]): Token[] {
  const tokens: Token[] = []
  for (const seg of raw) {
    const units = splitWords(seg.text)
    if (units.length <= 1) {
      tokens.push({ text: seg.text, start: seg.start, end: seg.end })
      continue
    }
    const total = units.reduce((a, u) => a + textWidth(u.text), 0) || 1
    const dur = seg.end - seg.start
    let acc = 0
    for (const u of units) {
      const s0 = seg.start + Math.round((acc / total) * dur)
      acc += textWidth(u.text)
      const e0 = seg.start + Math.round((acc / total) * dur)
      tokens.push({ text: u.text, start: s0, end: Math.max(e0, s0 + 20) })
    }
  }
  return splitTerminalInsideTokens(tokens)
}

// token 内部夹着句末标点（如 "好。那"）时在标点后切开，保证句子边界精确
function splitTerminalInsideTokens(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const t of tokens) {
    const parts: string[] = []
    let cur = ''
    for (const ch of t.text) {
      cur += ch
      if (isTerminalPunct(ch)) {
        parts.push(cur)
        cur = ''
      }
    }
    if (cur) parts.push(cur)
    if (parts.length <= 1) {
      out.push(t)
      continue
    }
    const total = textWidth(t.text) || 1
    const dur = t.end - t.start
    let acc = 0
    for (const p of parts) {
      const s0 = t.start + Math.round((acc / total) * dur)
      acc += textWidth(p)
      const e0 = t.start + Math.round((acc / total) * dur)
      out.push({ text: p, start: s0, end: Math.max(e0, s0 + 10) })
    }
  }
  return out
}
