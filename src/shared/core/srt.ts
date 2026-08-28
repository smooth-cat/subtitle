import type { Cue } from '../types'
import { padCueText, trimInvisible } from './text'

export function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const mss = t % 1000
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mss, 3)}`
}

export interface SrtExportOptions {
  padSpacing?: boolean // CJK 与英文/数字相邻处补半角空格（不改工程内原文本）
}

export function cuesToSrt(cues: Cue[], opts?: SrtExportOptions): string {
  return cues
    .filter((c) => c.text.trim())
    .map(
      (c, i) =>
        `${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n${padCueText(trimInvisible(c.text), opts?.padSpacing ?? false)}\n`
    )
    .join('\n')
}
