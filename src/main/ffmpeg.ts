import { spawn } from 'node:child_process'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { resolveFfmpeg, resolveFfprobe } from './binaries'
import { cacheDir } from './settings'
import { runProcess } from './jobs'
import type { ProbeResult } from '../shared/types'

function videoHash(videoPath: string): string {
  const st = fs.statSync(videoPath)
  return crypto
    .createHash('md5')
    .update(`${path.resolve(videoPath)}:${st.size}`)
    .digest('hex')
    .slice(0, 16)
    .toLowerCase()
}

// ─── ffprobe 探测 ────────────────────────────────────────────────

export interface BinPaths {
  ffmpegPath?: string
  ffprobePath?: string
}

export async function probeVideo(videoPath: string, bins: BinPaths = {}): Promise<ProbeResult> {
  const bin = await resolveFfprobe(bins.ffmpegPath, bins.ffprobePath)
  if (!bin) {
    const ffmpeg = await resolveFfmpeg(bins.ffmpegPath)
    if (ffmpeg) {
      throw new Error(
        `检测到 ffmpeg（${ffmpeg}），但缺少 ffprobe。\n请运行 brew install ffmpeg 补齐，或在「设置」中手动指定 ffprobe 路径。`
      )
    }
    throw new Error('未找到 ffprobe，请安装 ffmpeg（含 ffprobe）或在设置中指定路径')
  }
  const args = [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoPath
  ]
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`ffprobe 失败: ${stderr.slice(0, 400)}`))
    )
  })
  const info = JSON.parse(out) as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
    }>
  }
  const v = info.streams?.find((s) => s.codec_type === 'video')
  const a = info.streams?.find((s) => s.codec_type === 'audio')
  return {
    durationSec: parseFloat(info.format?.duration ?? '0') || 0,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    width: v?.width,
    height: v?.height
  }
}

// ─── 进度解析（ffmpeg -progress pipe:1 输出 out_time_ms=微秒）──────

function makeProgressParser(durationSec: number, cb: (percent: number) => void) {
  let buf = ''
  return (chunk: string) => {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = /^out_time_ms=(\d+)/.exec(line.trim())
      if (m && durationSec > 0) {
        const sec = parseInt(m[1], 10) / 1_000_000
        cb(Math.max(0, Math.min(100, (sec / durationSec) * 100)))
      }
    }
  }
}

// ─── 编码器说明 ──────────────────────────────────────────────────
// 实测（M1 Pro / macOS 15 / ffmpeg 9）：VideoToolbox 硬编虽然纯编码更快
// （1080p60 3.2s vs x264 medium 5.8s / 10s），但端到端管线（解码 + 字幕滤镜 + 编码）
// 中 VT 提交模型存在 ~3.3x 实时的吞吐上限，全流程反而比 x264 多线程慢
// （烧录 18s vs 15.3s、预览转码 18s vs 8.7s / 60s@1080p60）。
// 且超 4K 源（如 4112×2568 录屏）超过硬件编码器上限直接不可用。
// 结论：统一使用 libx264 多线程，速度与质量最优。
// whisper 转写不受影响，始终走 Metal GPU 加速。

// ─── 音频抽取（whisper 输入 16k 单声道 wav，带缓存）──────────────

export async function extractWav(
  jobId: string,
  videoPath: string,
  ffmpegPath: string | undefined,
  durationSec: number,
  onProgress: (percent: number) => void
): Promise<string> {
  const wavPath = path.join(cacheDir('wav'), videoHash(videoPath) + '.wav')
  try {
    const st = fs.statSync(wavPath)
    if (st.isFile() && st.size > 44) {
      onProgress(100)
      return wavPath
    }
  } catch {
    // 不存在则生成
  }
  const bin = await resolveFfmpeg(ffmpegPath)
  if (!bin) throw new Error('未找到 ffmpeg，请安装 ffmpeg 或在设置中指定路径')
  await runProcess(jobId, 'wav', bin, [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-progress',
    'pipe:1',
    '-nostats',
    wavPath
  ], {
    onStdout: makeProgressParser(durationSec, onProgress)
  })
  return wavPath
}

// ─── h265 预览转码兜底（转 h264 副本供 Chromium 播放）────────────

export async function transcodePreview(
  jobId: string,
  videoPath: string,
  ffmpegPath: string | undefined,
  durationSec: number,
  onProgress: (percent: number) => void
): Promise<string> {
  const outPath = path.join(cacheDir('preview'), videoHash(videoPath) + '.preview.mp4')
  try {
    const st = fs.statSync(outPath)
    if (st.isFile() && st.size > 1024) {
      onProgress(100)
      return outPath
    }
  } catch {
    // 不存在则转码
  }
  const bin = await resolveFfmpeg(ffmpegPath)
  if (!bin) throw new Error('未找到 ffmpeg，请安装 ffmpeg 或在设置中指定路径')
  await runProcess(jobId, 'transcode', bin, [
    '-y',
    '-i',
    videoPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outPath
  ], {
    onStdout: makeProgressParser(durationSec, onProgress)
  })
  return outPath
}

// ─── 硬字幕烧录 ──────────────────────────────────────────────────

export interface BurnOptions {
  jobId: string
  videoPath: string
  srtPath: string // 与 ffmpeg 进程同目录的相对文件名
  workDir: string
  outPath: string
  ffmpegPath?: string
  durationSec: number
  fontSize: number
  onProgress: (percent: number) => void
}

function escapeStyle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

export async function burnSubtitles(opts: BurnOptions): Promise<string> {
  const bin = await resolveFfmpeg(opts.ffmpegPath)
  if (!bin) throw new Error('未找到 ffmpeg，请安装 ffmpeg 或在设置中指定路径')
  const style = `FontName=PingFang SC,FontSize=${opts.fontSize},Outline=1,Shadow=0,MarginV=30,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1`
  const vf = `subtitles=filename=${escapeStyle(opts.srtPath)}:force_style='${escapeStyle(style)}'`
  await runProcess(opts.jobId, 'burn', bin, [
    '-y',
    '-i',
    opts.videoPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    opts.outPath
  ], {
    cwd: opts.workDir,
    onStdout: makeProgressParser(opts.durationSec, opts.onProgress)
  })
  return opts.outPath
}
