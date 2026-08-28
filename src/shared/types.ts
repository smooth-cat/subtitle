// 级时间戳单元（通常为词/单字，带真实毫秒时间）
export interface Token {
  text: string
  start: number // ms
  end: number // ms
}

// whisper 原始分段（json-full 的 transcription 项）
export interface RawSegment {
  text: string
  start: number // ms
  end: number // ms
}

export type CueSource = 'local' | 'manual' | 'ai'

export interface Cue {
  id: string
  text: string // 显示文本，行间用 \n 分隔
  start: number // ms
  end: number // ms
  tokenStart: number // 对应 tokens 的起始下标（含），-1 表示无映射（手动新增）
  tokenEnd: number // 对应 tokens 的结束下标（不含）
  source: CueSource
}

export interface AssembleSettings {
  maxLineChars: number // 每行最大字数（CJK=1，拉丁≈0.5）
  maxLines: number // 单条字幕最多行数
  maxCueDurationMs: number // 单条字幕最大时长
  endBufferMs: number // 句尾缓冲，不超过下一句开始
}

export interface SubProject {
  version: 1
  id: string
  name: string
  video: { path: string; name: string; durationMs: number }
  language: string
  tokens: Token[]
  rawSegments: RawSegment[]
  cues: Cue[]
  assemble: AssembleSettings
  updatedAt: string
}

export interface RecentEntry {
  id: string
  name: string
  videoPath: string
  videoName: string
  updatedAt: string
}

export interface Settings {
  whisperPath?: string
  ffmpegPath?: string
  ffprobePath?: string
  modelPath?: string
  language: string
  assemble: AssembleSettings
  // 字幕样式（CSS），预览与烧录共用同一份
  subtitleCss: string
}

export interface ProbeResult {
  durationSec: number
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
}

export type JobKind = 'wav' | 'transcode' | 'transcribe' | 'burn'

export interface JobEvent {
  jobId: string
  kind: JobKind
  percent?: number
  message?: string
  done?: boolean
  error?: string
}

export interface ModelStatus {
  path?: string
  exists: boolean
  sizeBytes?: number
  ggufValid?: boolean
  message?: string
}

export interface BinariesStatus {
  whisper?: string
  ffmpeg?: string
  ffprobe?: string
}

export interface TranscribeResult {
  tokens: Token[]
  rawSegments: RawSegment[]
  language: string
  modelPath: string
}

export const DEFAULT_ASSEMBLE: AssembleSettings = {
  maxLineChars: 16,
  maxLines: 2,
  maxCueDurationMs: 8000,
  endBufferMs: 1000
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'zh',
  assemble: { ...DEFAULT_ASSEMBLE },
  subtitleCss: ''
}
