import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

async function which(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [name])
    const p = stdout.trim()
    return p && (await isExecutable(p)) ? p : null
  } catch {
    return null
  }
}

function home(): string {
  return os.homedir()
}

// 依次尝试：用户手动指定 → PATH → 常见安装位置
export async function resolveBinary(
  configured: string | undefined,
  names: string[],
  extraCandidates: string[]
): Promise<string | null> {
  if (configured && (await isExecutable(configured))) return configured
  for (const n of names) {
    const w = await which(n)
    if (w) return w
  }
  for (const c of extraCandidates) {
    const p = c.replace(/^~/, home())
    if (await isExecutable(p)) return p
  }
  return null
}

export async function resolveWhisper(configured?: string): Promise<string | null> {
  return resolveBinary(
    configured,
    ['whisper-cli', 'whisper-cpp', 'whisper.cpp', 'whisper'],
    [
      '~/whisper.cpp/build/bin/whisper-cli',
      '~/whisper.cpp/build/bin/main',
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli'
    ]
  )
}

export async function resolveFfmpeg(configured?: string): Promise<string | null> {
  return resolveBinary(configured, ['ffmpeg'], ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'])
}

export async function resolveFfprobe(
  ffmpegPath?: string,
  ffprobePath?: string
): Promise<string | null> {
  // 1. 显式配置的 ffprobe
  if (ffprobePath && (await isExecutable(ffprobePath))) return ffprobePath
  // 2. 可用的 ffmpeg 同目录下的 ffprobe（静态 ffmpeg 目录常搭配放置）
  if (ffmpegPath && (await isExecutable(ffmpegPath))) {
    const sibling = path.join(path.dirname(ffmpegPath), 'ffprobe')
    if (await isExecutable(sibling)) return sibling
  }
  // 3. PATH 与常见位置
  return resolveBinary(undefined, ['ffprobe'], ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'])
}
