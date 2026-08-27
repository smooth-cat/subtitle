import type { AssembleSettings, CueSource } from '../types'
import type { Sentence } from './sentence'
import { splitWords, type WordUnit } from './segmenter'
import { isSecondaryPunct, textWidth, trimInvisible } from './text'

export interface CueDraft {
  text: string // 行间用 \n
  start: number
  end: number
  tokenStart: number
  tokenEnd: number
  source: CueSource
}

interface Chunk {
  text: string
  start: number
  end: number
  tokenStart: number
  tokenEnd: number
}

function chunkFromTokens(tokens: Sentence['tokens'], from: number, to: number, baseIndex: number): Chunk {
  const slice = tokens.slice(from, to)
  return {
    text: slice.map((t) => t.text).join(''),
    start: slice[0].start,
    end: slice[slice.length - 1].end,
    tokenStart: baseIndex + from,
    tokenEnd: baseIndex + to
  }
}

// 单句 → 字幕条（可能 1 条或多条）。不超过上限则一条；超长在词边界拆分。
function sentenceToCues(s: Sentence, cfg: AssembleSettings): CueDraft[] {
  const cap = cfg.maxLineChars * cfg.maxLines
  const width = textWidth(s.text)
  const dur = Math.max(0, s.end - s.start)
  if (width <= cap && dur <= cfg.maxCueDurationMs) {
    return [draftFromChunk({ text: s.text, start: s.start, end: s.end, tokenStart: s.tokenStart, tokenEnd: s.tokenEnd }, cfg)]
  }
  const chunks = splitSentence(s, cfg, cap)
  const parts: Chunk[] = []
  for (const c of chunks) parts.push(...hardSplitIfNeeded(c, cfg))
  return parts.map((c) => draftFromChunk(c, cfg))
}

function draftFromChunk(c: Chunk, cfg: AssembleSettings): CueDraft {
  return {
    text: wrapText(c.text, cfg).join('\n'),
    start: c.start,
    end: c.end,
    tokenStart: c.tokenStart,
    tokenEnd: c.tokenEnd,
    source: 'local'
  }
}

// 超长句拆分：在词边界候选断点中切块，优先二级标点之后，尽量均衡
function splitSentence(s: Sentence, cfg: AssembleSettings, cap: number): Chunk[] {
  const toks = s.tokens
  if (toks.length === 0) {
    return [{ text: s.text, start: s.start, end: s.end, tokenStart: s.tokenStart, tokenEnd: s.tokenEnd }]
  }
  const results: Chunk[] = []
  let i = 0
  for (let guard = 0; guard < 1000; guard++) {
    const rest = toks.slice(i)
    const restWidth = textWidth(rest.map((t) => t.text).join(''))
    const restDur = Math.max(0, rest[rest.length - 1].end - rest[0].start)
    const remaining = Math.max(Math.ceil(restWidth / cap), Math.ceil(restDur / cfg.maxCueDurationMs))
    if (remaining <= 1) break

    const targetWidth = restWidth / remaining
    const targetDur = restDur / remaining
    let best = -1
    let bestScore = Infinity
    for (let j = i + 1; j < toks.length; j++) {
      const w = textWidth(toks.slice(i, j).map((t) => t.text).join(''))
      const d = Math.max(0, toks[j - 1].end - toks[i].start)
      // 超出上限太多的块不可取（除非已经没有任何可选断点）
      if (w > cap * 1.2 || d > cfg.maxCueDurationMs * 1.2) continue
      const punctAfter = isSecondaryPunct(trimInvisible(toks[j - 1].text).slice(-1))
      const score =
        Math.abs(w - targetWidth) / Math.max(targetWidth, 1) +
        Math.abs(d - targetDur) / Math.max(targetDur, 1) -
        (punctAfter ? 0.35 : 0)
      if (score < bestScore) {
        bestScore = score
        best = j
      }
    }
    if (best < 0) break
    results.push(chunkFromTokens(toks, i, best, s.tokenStart))
    i = best
  }
  results.push(chunkFromTokens(toks, i, toks.length, s.tokenStart))
  return results
}

// 极端兜底：块仍然超宽/超时（如无边界长串），按字符占比强制切
function hardSplitIfNeeded(c: Chunk, cfg: AssembleSettings): Chunk[] {
  const cap = cfg.maxLineChars * cfg.maxLines
  const over = textWidth(c.text) > cap || c.end - c.start > cfg.maxCueDurationMs * 1.6
  if (!over) return [c]

  let units: WordUnit[] = splitWords(c.text)
  // 单个词单元本身超长（如长 URL）→ 按宽度硬切字符
  const hardUnits: WordUnit[] = []
  for (const u of units) {
    if (textWidth(u.text) <= cap * 0.9) {
      hardUnits.push(u)
      continue
    }
    let cur = ''
    let curStart = u.start
    let curW = 0
    for (const ch of u.text) {
      const w = textWidth(ch)
      if (cur && curW + w > cap * 0.9) {
        hardUnits.push({ text: cur, start: curStart, end: curStart + cur.length })
        curStart += cur.length
        cur = ch
        curW = w
      } else {
        cur += ch
        curW += w
      }
    }
    if (cur) hardUnits.push({ text: cur, start: curStart, end: curStart + cur.length })
  }
  units = hardUnits

  const totalW = units.reduce((a, u) => a + textWidth(u.text), 0) || 1
  const span = Math.max(1, c.end - c.start)
  const pieces: Chunk[] = []
  let acc = 0
  let group: WordUnit[] = []
  let groupW = 0
  const pushGroup = () => {
    if (!group.length) return
    const text = group.map((u) => u.text).join('')
    const wFrac = acc / totalW
    const start = c.start + Math.round(wFrac * span)
    acc += groupW
    const end = c.start + Math.round((acc / totalW) * span)
    pieces.push({
      text,
      start,
      end: Math.max(end, start + 100),
      tokenStart: c.tokenStart,
      tokenEnd: c.tokenEnd
    })
    group = []
    groupW = 0
  }
  for (const u of units) {
    const w = textWidth(u.text)
    if (group.length && groupW + w > cap) pushGroup()
    group.push(u)
    groupW += w
  }
  pushGroup()
  return pieces.length ? pieces : [c]
}

// 全量组装：句 → 字幕条，再统一做句尾缓冲与下一句开始钳制
export function assembleCues(sentences: Sentence[], cfg: AssembleSettings): CueDraft[] {
  const drafts: CueDraft[] = []
  for (const s of sentences) drafts.push(...sentenceToCues(s, cfg))
  for (let i = 0; i < drafts.length; i++) {
    const cur = drafts[i]
    let end = cur.end + cfg.endBufferMs
    if (i + 1 < drafts.length) end = Math.min(end, drafts[i + 1].start - 20)
    end = Math.max(end, cur.start + 200)
    cur.end = end
  }
  return drafts
}

// 换行规则（显示层）：最多 2 行时寻找最优单断点——优先二级标点处，其次行容量内最接近行尾的词边界；
// 多行配置用贪心逐行填充（整词换行，绝不截断词组）。
export function wrapText(text: string, cfg: AssembleSettings): string[] {
  const cap = cfg.maxLineChars
  if (textWidth(text) <= cap) return [text]
  const units = splitWords(text)

  if (cfg.maxLines === 2) {
    let best = -1
    let bestScore = -Infinity
    for (let i = 1; i < units.length; i++) {
      const l1 = textWidth(joinUnits(units, 0, i))
      const l2 = textWidth(joinUnits(units, i, units.length))
      if (l1 > cap || l2 > cap) continue
      const prevChar = trimInvisible(units[i - 1].text).slice(-1)
      const punct = isSecondaryPunct(prevChar)
      const score = (punct ? 1000 : 0) + l1
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    if (best > 0) return [joinUnits(units, 0, best), joinUnits(units, best, units.length)]
  }

  // 通用贪心（maxLines > 2 或 2 行无可行断点）
  const lines: string[] = []
  let cur = ''
  let curW = 0
  for (const u of units) {
    const w = textWidth(u.text)
    if (cur && curW + w > cap) {
      lines.push(cur)
      cur = u.text
      curW = w
    } else {
      cur += u.text
      curW += w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function joinUnits(units: WordUnit[], from: number, to: number): string {
  return units
    .slice(from, to)
    .map((u) => u.text)
    .join('')
}
