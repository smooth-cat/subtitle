import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_ASSEMBLE, DEFAULT_SETTINGS, type Settings } from '../shared/types'
import { normalizeSubtitleCss } from '../shared/subtitleStyle'

export function userDataDir(): string {
  return app.getPath('userData')
}

export function ensureDir(...parts: string[]): string {
  const p = path.join(...parts)
  fs.mkdirSync(p, { recursive: true })
  return p
}

export function projectsDir(): string {
  return ensureDir(userDataDir(), 'projects')
}

// 只接收目录段；文件名由调用方用 path.join 拼接，避免把文件名建成目录
export function cacheDir(...sub: string[]): string {
  return ensureDir(userDataDir(), 'cache', ...sub)
}

export function settingsFile(): string {
  return path.join(userDataDir(), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      assemble: { ...DEFAULT_ASSEMBLE, ...(raw.assemble ?? {}) },
      subtitleCss: normalizeSubtitleCss(raw.subtitleCss)
    }
  } catch {
    return { ...DEFAULT_SETTINGS, assemble: { ...DEFAULT_ASSEMBLE }, subtitleCss: normalizeSubtitleCss(undefined) }
  }
}

export function saveSettings(s: Settings): void {
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
}
