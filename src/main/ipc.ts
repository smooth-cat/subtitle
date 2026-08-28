import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  BinariesStatus,
  ModelStatus,
  RecentEntry,
  Settings,
  SubProject
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { cacheDir, loadSettings, saveSettings } from './settings'
import { loadProject, projectIdForVideo, listRecent, saveProject } from './projects'
import { resolveFfmpeg, resolveFfprobe, resolveWhisper } from './binaries'
import { probeVideo, transcodePreview } from './ffmpeg'
import { burnWithCss } from './cssBurn'
import { transcribeVideo } from './whisper'
import { cancelJob, isJobCancelled } from './jobs'
import { mediaServerUrl } from './protocol'

const execFileAsync = promisify(execFile)

const VIDEO_EXTS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'ts', 'flv', 'wmv']

async function validateModel(modelPath: string): Promise<ModelStatus> {
  try {
    const st = fs.statSync(modelPath)
    if (!st.isFile()) return { path: modelPath, exists: false, message: '路径不是文件' }
    let ggufValid = false
    try {
      const fh = await fs.promises.open(modelPath, 'r')
      const buf = Buffer.alloc(4)
      await fh.read(buf, 0, 4, 0)
      await fh.close()
      ggufValid = buf.toString('ascii') === 'GGUF'
    } catch {
      ggufValid = false
    }
    return {
      path: modelPath,
      exists: true,
      sizeBytes: st.size,
      ggufValid,
      message: ggufValid ? undefined : '文件头不是 GGUF，可能不是 whisper.cpp 的 gguf 模型'
    }
  } catch {
    return { path: modelPath, exists: false, message: '文件不存在' }
  }
}

function projectSkeleton(videoPath: string, durationMs: number, language: string): SubProject {
  const id = projectIdForVideo(videoPath)
  return {
    version: 1,
    id,
    name: path.basename(videoPath, path.extname(videoPath)),
    video: { path: path.resolve(videoPath), name: path.basename(videoPath), durationMs },
    language,
    tokens: [],
    rawSegments: [],
    cues: [],
    assemble: loadSettings().assemble,
    updatedAt: new Date().toISOString()
  }
}

export function registerIpc(): void {
  // ─── 文件选择 ────────────────────────────────────────────────
  ipcMain.handle('dialog:openVideo', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: '打开视频',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: VIDEO_EXTS },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const p = res.filePaths[0]
    return { path: p, name: path.basename(p) }
  })

  ipcMain.handle('dialog:pickFile', async (_e, opts: { title?: string; extensions?: string[] }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: opts.title ?? '选择文件',
      properties: ['openFile'],
      filters: opts.extensions?.length
        ? [{ name: '文件', extensions: opts.extensions }, { name: '所有文件', extensions: ['*'] }]
        : [{ name: '所有文件', extensions: ['*'] }]
    })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_e, opts: { defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const res = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultName,
      filters: opts.filters
    })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle('dialog:saveDir', async (_e, opts: { defaultName: string }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const res = await dialog.showSaveDialog(win, {
      title: '选择输出位置',
      defaultPath: opts.defaultName,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle('app:showInFolder', async (_e, p: string) => {
    shell.showItemInFolder(p)
  })

  // ─── 媒体探测 ────────────────────────────────────────────────
  ipcMain.handle('media:url', async (_e, filePath: string) => {
    return mediaServerUrl(filePath)
  })

  ipcMain.handle('media:probe', async (_e, videoPath: string) => {
    const s = loadSettings()
    return probeVideo(videoPath, s)
  })

  // ─── 工程文件 ────────────────────────────────────────────────
  ipcMain.handle('project:loadForVideo', async (_e, videoPath: string) => {
    const settings = loadSettings()
    const id = projectIdForVideo(videoPath)
    const existing = loadProject(id)
    if (existing) {
      // 视频时长缺失时补探
      if (!existing.video.durationMs) {
        try {
          const probe = await probeVideo(videoPath, settings)
          existing.video.durationMs = Math.round(probe.durationSec * 1000)
        } catch {
          // ignore
        }
      }
      saveProject(existing)
      return { project: existing }
    }
    let durationMs = 0
    try {
      const probe = await probeVideo(videoPath, settings)
      durationMs = Math.round(probe.durationSec * 1000)
    } catch {
      // ignore
    }
    const proj = projectSkeleton(videoPath, durationMs, settings.language)
    saveProject(proj)
    return { project: proj }
  })

  ipcMain.handle('project:save', async (_e, project: SubProject) => {
    saveProject(project)
    return true
  })

  ipcMain.handle('project:recent', async (): Promise<RecentEntry[]> => {
    return listRecent()
  })

  // ─── 设置 / 模型 / 二进制 ────────────────────────────────────
  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:set', async (_e, s: Settings) => {
    const merged: Settings = { ...DEFAULT_SETTINGS, ...s, assemble: s.assemble }
    saveSettings(merged)
    return merged
  })

  ipcMain.handle('model:validate', async (_e, p?: string) => {
    const settings = loadSettings()
    const modelPath = p ?? settings.modelPath
    if (!modelPath) return { exists: false } as ModelStatus
    return validateModel(modelPath)
  })

  ipcMain.handle('binaries:detect', async () => {
    const s = loadSettings()
    const status: BinariesStatus = {}
    const w = await resolveWhisper(s.whisperPath)
    if (w) status.whisper = w
    const f = await resolveFfmpeg(s.ffmpegPath)
    if (f) status.ffmpeg = f
    const fp = await resolveFfprobe(s.ffmpegPath, s.ffprobePath)
    if (fp) status.ffprobe = fp
    return status
  })

  // whisper-cli --help 输出 model 说明，用于校验可用性
  ipcMain.handle('binaries:checkWhisper', async (_e, p: string) => {
    try {
      await execFileAsync(p, ['--help'], { timeout: 8000 })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: String((err as Error).message ?? err) }
    }
  })

  // ─── 长任务 ──────────────────────────────────────────────────
  ipcMain.handle('media:transcodePreview', async (_e, jobId: string, videoPath: string) => {
    const s = loadSettings()
    const probe = await probeVideo(videoPath, s)
    return transcodePreview(jobId, videoPath, s.ffmpegPath, probe.durationSec, (percent) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('job:event', {
        jobId,
        kind: 'transcode',
        percent,
        message: '正在生成 h264 预览副本…'
      })
    )
  })

  ipcMain.handle('whisper:transcribe', async (_e, jobId: string, videoPath: string, language: string) => {
    const s = loadSettings()
    const probe = await probeVideo(videoPath, s)
    return transcribeVideo({
      jobId,
      videoPath,
      durationSec: probe.durationSec,
      language
    })
  })

  ipcMain.handle('burn:run', async (_e, req: {
    jobId: string
    videoPath: string
    cues: Array<{ text: string; start: number; end: number }>
    css: string
    outPath: string
  }) => {
    const s = loadSettings()
    const probe = await probeVideo(req.videoPath, s)
    if (!probe.width || !probe.height) throw new Error('无法获取视频分辨率，无法烧录')
    const workDir = cacheDir('burn', req.jobId)
    try {
      return await burnWithCss({
        jobId: req.jobId,
        videoPath: req.videoPath,
        cues: req.cues,
        css: req.css,
        width: probe.width,
        height: probe.height,
        workDir,
        outPath: req.outPath,
        ffmpegPath: s.ffmpegPath,
        durationSec: probe.durationSec,
        onProgress: (percent, message) =>
          BrowserWindow.getAllWindows()[0]?.webContents.send('job:event', {
            jobId: req.jobId,
            kind: 'burn',
            percent,
            message: message ?? '正在烧录字幕…'
          }),
        isCancelled: () => isJobCancelled(req.jobId)
      })
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  ipcMain.handle('job:cancel', async (_e, jobId: string) => cancelJob(jobId))

  ipcMain.handle('app:copyToClipboard', async (_e, text: string) => {
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle('app:writeTextFile', async (_e, p: string, content: string) => {
    fs.writeFileSync(p, content, 'utf8')
    return true
  })
}
