import fs from 'node:fs'
import path from 'node:path'
import { resolveWhisper } from './binaries'
import { cacheDir, loadSettings } from './settings'
import { extractWav } from './ffmpeg'
import { runProcess, sendProgress } from './jobs'
import { parseWhisperJson, rawToTokens, type WhisperJsonFull } from '../shared/core/tokens'
import type { TranscribeResult } from '../shared/types'

// whisper.cpp CLI 子进程：json-full 输出 + -ml 1 -sow 获取词级时间戳
export async function transcribeVideo(opts: {
  jobId: string
  videoPath: string
  durationSec: number
  language?: string
}): Promise<TranscribeResult> {
  const settings = loadSettings()
  const whisperBin = await resolveWhisper(settings.whisperPath)
  if (!whisperBin) {
    throw new Error(
      '未找到 whisper.cpp 命令行程序（whisper-cli）。\n请安装 whisper.cpp 并确保 whisper-cli 在 PATH 中，或在设置中手动指定路径。'
    )
  }
  const modelPath = settings.modelPath
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error('尚未置入模型文件。请下载 large-v3-turbo gguf 模型（约 1.6GB）后拖入应用窗口。')
  }

  const language = opts.language ?? settings.language ?? 'zh'

  // 1. 抽取 16k 单声道 wav（0 ~ 15%）
  sendProgress(opts.jobId, 'transcribe', 1, '正在抽取音频…')
  const wavPath = await extractWav(
    `${opts.jobId}-wav`,
    opts.videoPath,
    settings.ffmpegPath,
    opts.durationSec,
    (p) => sendProgress(opts.jobId, 'transcribe', Math.max(1, Math.min(15, p * 0.15)), '正在抽取音频…')
  )
  sendProgress(opts.jobId, 'transcribe', 15, '音频抽取完成')

  // 2. 运行 whisper.cpp（15% ~ 90%）
  const outDir = cacheDir('whisper', opts.jobId)
  const prefix = path.join(outDir, 'result')
  const args = [
    '-m',
    modelPath,
    '-f',
    wavPath,
    '-ojf', // json-full：包含每个分段/词的时间与文本
    '-of',
    prefix,
    '-ml',
    '1',
    '-sow', // 按词切分段，获得词级真实时间戳
    '-np', // 不打印文本到 stdout
    '-pp', // 打印进度到 stderr
    '-l',
    language
  ]
  sendProgress(opts.jobId, 'transcribe', 16, '正在转写（large-v3-turbo，可能耗时较长）…')
  const startedAt = Date.now()
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - startedAt) / 1000)
    sendProgress(opts.jobId, 'transcribe', undefined, `正在转写… 已运行 ${sec} 秒`)
  }, 1000)

  try {
    await runProcess(opts.jobId, 'transcribe', whisperBin, args, {
      onStderr: (chunk) => {
        for (const m of chunk.matchAll(/(\d{1,3})%/g)) {
          const pct = parseInt(m[1], 10)
          if (pct >= 0 && pct <= 100) {
            sendProgress(opts.jobId, 'transcribe', 15 + pct * 0.75)
          }
        }
      }
    })
  } finally {
    clearInterval(timer)
  }

  // 3. 解析 json-full（90% ~ 96%）
  sendProgress(opts.jobId, 'transcribe', 92, '正在解析转写结果…')
  const jsonFile = `${prefix}.json`
  if (!fs.existsSync(jsonFile)) {
    throw new Error('whisper 未生成 json 结果文件，转写可能失败')
  }
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as WhisperJsonFull
  const rawSegments = parseWhisperJson(json)
  if (!rawSegments.length) {
    throw new Error('转写结果为空：未识别到任何语音内容')
  }
  const tokens = rawToTokens(rawSegments)

  // 清理临时目录（wav 结果缓存保留）
  try {
    fs.rmSync(outDir, { recursive: true, force: true })
  } catch {
    // ignore
  }

  sendProgress(opts.jobId, 'transcribe', 100, '转写完成')
  return {
    tokens,
    rawSegments,
    language: json.result?.language ?? language,
    modelPath
  }
}
