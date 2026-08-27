import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { RecentEntry, SubProject } from '../shared/types'
import { projectsDir, userDataDir } from './settings'

// 工程文件由应用数据目录统一管理：projects/{视频名}-{路径哈希}.subproj.json
export function projectIdForVideo(videoPath: string): string {
  const abs = path.resolve(videoPath)
  const hash = crypto.createHash('md5').update(abs.toLowerCase()).digest('hex').slice(0, 12)
  const base =
    path
      .basename(abs, path.extname(abs))
      .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
      .slice(0, 40) || 'video'
  return `${base}-${hash}`
}

export function projectFileFor(id: string): string {
  return path.join(projectsDir(), `${id}.subproj.json`)
}

export function loadProjectFile(file: string): SubProject | null {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8')) as SubProject
    if (p && p.version === 1 && Array.isArray(p.cues)) return p
    return null
  } catch {
    return null
  }
}

export function loadProject(id: string): SubProject | null {
  return loadProjectFile(projectFileFor(id))
}

export function saveProject(p: SubProject): string {
  p.updatedAt = new Date().toISOString()
  const file = projectFileFor(p.id)
  fs.writeFileSync(file, JSON.stringify(p, null, 2), 'utf8')
  touchRecent(p)
  return file
}

// ─── 最近打开列表 ────────────────────────────────────────────────

function recentFile(): string {
  return path.join(userDataDir(), 'recent.json')
}

function readRecent(): RecentEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8')) as RecentEntry[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function touchRecent(p: SubProject): void {
  const list = readRecent().filter((e) => e.id !== p.id)
  list.unshift({
    id: p.id,
    name: p.name,
    videoPath: p.video.path,
    videoName: p.video.name,
    updatedAt: p.updatedAt
  })
  fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 20), null, 2), 'utf8')
}

export function listRecent(): RecentEntry[] {
  return readRecent()
}
