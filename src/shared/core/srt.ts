import type { Cue } from '../types'

export function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const mss = t % 1000
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mss, 3)}`
}

export function cuesToSrt(cues: Cue[]): string {
  return cues
    .filter((c) => c.text.trim())
    .map((c, i) => `${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n${c.text.trim()}\n`)
    .join('\n')
}
