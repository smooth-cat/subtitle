import type { AssembleSettings, RawSegment, Token } from '../types'
import { textWidth, trimInvisible } from './text'
import type { CueDraft } from './assemble'

// ─── 导出待断句文本 ───────────────────────────────────────────────

export interface AiExport {
  fileText: string // #序号 文本 每行一条原始转写
  prompt: string // 一键复制的提示词模板
  segStart: number // 命中的 rawSegments 起始下标
  segEnd: number // 结束下标（不含）
}

// 支持全文导出与时间段分块导出（range 为毫秒时间窗）
export function buildAiExport(raw: RawSegment[], range?: { from: number; to: number }): AiExport {
  let hit = raw.map((_, i) => i)
  if (range) {
    hit = hit.filter((i) => raw[i].end > range.from && raw[i].start < range.to)
  }
  if (hit.length === 0) hit = raw.map((_, i) => i)
  const segStart = hit[0]
  const segEnd = hit[hit.length - 1] + 1
  const lines = hit.map((i, k) => `#${k + 1} ${trimInvisible(raw[i].text)}`)
  const fileText = lines.join('\n')
  const prompt = [
    '你是一名字幕断句助手。下面是一段视频的字幕原始转写文本，每行开头的 #数字 是行号标记。',
    '要求：',
    '1. 不得改动、增删、翻译任何文字，保持标点、简繁体、大小写与所有字符原样；',
    '2. 只做一件事：在各句之间的词边界处插入换行，把文本整理成「一行一个完整句子」；',
    '3. 输出时去掉行号标记（#数字），不要合并或重排文本，不要添加任何解释；',
    '4. 直接输出处理后的全部文本。',
    '',
    '文本：',
    fileText
  ].join('\n')
  return { fileText, prompt, segStart, segEnd }
}

// ─── 粘贴导入校验与时间轴重建 ────────────────────────────────────

export interface AiImportOk {
  ok: true
  cues: CueDraft[]
  warnings: string[]
}

export interface AiImportFail {
  ok: false
  message: string
  diff: { expected: string; got: string; index: number } | null
}

export type AiImportResult = AiImportOk | AiImportFail

const norm = (s: string): string => s.replace(/\s+/g, '')

// 每个元素在“去空白全文”中的起始偏移
function buildOffsets(items: Array<{ text: string }>): number[] {
  const offsets: number[] = []
  let acc = 0
  for (const it of items) {
    offsets.push(acc)
    acc += norm(it.text).length
  }
  return offsets
}

// 在原文（rawSegments 级）中寻找与 AI 返回文本匹配的窗口
function findRawWindow(raw: RawSegment[], aiNorm: string): { start: number; end: number } | null {
  const offsets = buildOffsets(raw)
  const fullNorm = raw.map((r) => norm(r.text)).join('')
  for (let i = 0; i < raw.length; i++) {
    const start = offsets[i]
    if (aiNorm.length > fullNorm.length - start) break
    if (fullNorm.startsWith(aiNorm, start)) {
      return { start, end: start + aiNorm.length }
    }
  }
  return null
}

// 将断点的去空白字符偏移吸附到最近的 token 词边界
function snapToTokenBoundary(offsets: number[], off: number): { tokenIndex: number; exact: boolean } {
  let best = 0
  let bestDist = Infinity
  for (let j = 0; j < offsets.length; j++) {
    const d = Math.abs(offsets[j] - off)
    if (d < bestDist) {
      bestDist = d
      best = j
    }
    if (offsets[j] > off && offsets[j] - off > bestDist) break
  }
  return { tokenIndex: best, exact: bestDist === 0 }
}

function firstDiff(expected: string, got: string): { index: number } {
  const n = Math.min(expected.length, got.length)
  for (let i = 0; i < n; i++) {
    if (expected[i] !== got[i]) return { index: i }
  }
  return { index: n }
}

function contextAround(s: string, index: number, span = 12): string {
  const from = Math.max(0, index - span)
  const to = Math.min(s.length, index + span)
  return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '')
}

// 校验粘贴回的 AI 结果并生成字幕草稿：
// 1. 拼接全部文字与原文逐字比对（忽略空白，因为换行位置本来就会变）
// 2. 断点字符偏移映射到词边界（AI 断在词组内部时吸附并提示）
// 3. 用词级时间戳生成时间轴，一条 AI 行 = 一条字幕
export function parseAiImport(
  pasted: string,
  raw: RawSegment[],
  tokens: Token[],
  cfg: AssembleSettings
): AiImportResult {
  const lines = pasted
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*#\d+\s*/, ''))
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) {
    return { ok: false, message: '没有解析到任何内容，请粘贴 AI 返回的文本。', diff: null }
  }

  const aiNorm = norm(lines.join(''))
  if (!aiNorm) {
    return { ok: false, message: '没有解析到任何有效文字。', diff: null }
  }

  const win = findRawWindow(raw, aiNorm)
  if (!win) {
    const fullNorm = raw.map((r) => norm(r.text)).join('')
    const { index } = firstDiff(fullNorm, aiNorm)
    return {
      ok: false,
      message:
        '校验失败：AI 返回的文字与原始转写不一致（不得改动任何文字）。请重试，或检查是否粘贴了完整内容。',
      diff: {
        expected: contextAround(fullNorm, index),
        got: contextAround(aiNorm, index),
        index
      }
    }
  }

  // 映射到 token 窗口
  const tokOffsets = buildOffsets(tokens)
  let tokStart = -1
  let tokEnd = tokens.length
  for (let j = 0; j < tokOffsets.length; j++) {
    if (tokStart === -1 && tokOffsets[j] >= win.start) tokStart = j
    if (tokOffsets[j] >= win.end) {
      tokEnd = j
      break
    }
  }
  if (tokStart === -1 || tokEnd <= tokStart) {
    return { ok: false, message: '内部错误：无法把文本窗口映射到词级时间戳。', diff: null }
  }

  // 每个 AI 行末尾对应的去空白偏移（相对全文）作为断点
  const breaks: number[] = []
  let acc = win.start
  for (let i = 0; i < lines.length; i++) {
    acc += norm(lines[i]).length
    if (i < lines.length - 1) breaks.push(acc)
  }

  const warnings: string[] = []
  const boundaries: number[] = [tokStart]
  for (const off of breaks) {
    const snapped = snapToTokenBoundary(tokOffsets, off)
    if (!snapped.exact) {
      warnings.push(`断点「${contextAround(aiNorm, off, 6)}」不在词边界，已吸附到最近的词边界`)
    }
    if (snapped.tokenIndex > boundaries[boundaries.length - 1]) {
      boundaries.push(snapped.tokenIndex)
    }
  }
  boundaries.push(tokEnd)

  const drafts: CueDraft[] = []
  for (let b = 0; b < boundaries.length - 1; b++) {
    const from = boundaries[b]
    const to = boundaries[b + 1]
    if (to <= from) continue
    const slice = tokens.slice(from, to)
    const text = slice.map((t) => t.text).join('')
    if (!trimInvisible(text)) continue
    drafts.push({
      text,
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      tokenStart: from,
      tokenEnd: to,
      source: 'ai'
    })
  }
  if (!drafts.length) {
    return { ok: false, message: '校验通过，但未能生成任何字幕条。', diff: null }
  }

  // 句尾缓冲 + 下一句开始钳制（与本地断句规则一致）
  for (let i = 0; i < drafts.length; i++) {
    const cur = drafts[i]
    let end = cur.end + cfg.endBufferMs
    if (i + 1 < drafts.length) end = Math.min(end, drafts[i + 1].start - 20)
    end = Math.max(end, cur.start + 200)
    cur.end = end
  }

  // AI 切出超长单条时提示（保留 AI 断句，不强制重切）
  const cap = cfg.maxLineChars * cfg.maxLines
  const longCues = drafts.filter((d) => textWidth(d.text) > cap).length
  if (longCues > 0) {
    warnings.push(`${longCues} 条字幕超过 ${cap} 字上限，按 AI 的断句保留；可在列表中手动编辑。`)
  }

  return { ok: true, cues: drafts, warnings }
}

// 被导入草稿覆盖的时间范围，供渲染层替换对应旧字幕条
export function aiWindowTimeRange(drafts: CueDraft[]): { from: number; to: number } {
  if (!drafts.length) return { from: 0, to: 0 }
  return { from: drafts[0].start, to: drafts[drafts.length - 1].end }
}
