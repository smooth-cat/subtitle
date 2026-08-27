import type { Api } from '../../shared/api'

declare global {
  interface Window {
    api: Api
  }
}

export const api: Api = window.api

let jobCounter = 0
export function newJobId(): string {
  jobCounter += 1
  return `job-${Date.now()}-${jobCounter}`
}

export function fmtTime(ms: number, withMs = true): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const mss = t % 1000
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
  return withMs ? `${base}.${pad(mss, 3)}` : base
}

// 宽松解析时间：支持 12.3 / 1:23.4 / 1:02:03.456（单位：秒）
export function parseTimeInput(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const parts = t.split(':')
  if (parts.length > 3) return null
  let sec = 0
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null
    sec = sec * 60 + parseFloat(part)
  }
  return Math.round(sec * 1000)
}

export function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}
