import type {
  BinariesStatus,
  JobEvent,
  ModelStatus,
  ProbeResult,
  RecentEntry,
  Settings,
  SubProject,
  Token,
  RawSegment
} from './types'

// 主进程 ↔ 渲染进程桥接 API（由 preload 实现，渲染层调用）
export interface Api {
  // 对话框
  openVideoDialog(): Promise<{ path: string; name: string } | null>
  pickFile(opts: { title?: string; extensions?: string[] }): Promise<string | null>
  saveFileDialog(opts: {
    defaultName: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  saveDirDialog(opts: { defaultName: string }): Promise<string | null>
  getPathForFile(file: File): string
  showInFolder(p: string): Promise<void>
  copyToClipboard(text: string): Promise<boolean>
  writeTextFile(p: string, content: string): Promise<boolean>

  // 媒体
  mediaUrl(filePath: string): Promise<string>
  probeVideo(videoPath: string): Promise<ProbeResult>
  transcodePreview(jobId: string, videoPath: string): Promise<string>

  // 工程
  loadForVideo(videoPath: string): Promise<{ project: SubProject | null }>
  saveProject(project: SubProject): Promise<boolean>
  recentProjects(): Promise<RecentEntry[]>
  removeRecent(id: string, deleteProject: boolean): Promise<boolean>
  projectFileInfo(id: string): Promise<{ path: string; exists: boolean; sizeBytes: number }>

  // 设置 / 模型 / 二进制
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<Settings>
  validateModel(p?: string): Promise<ModelStatus>
  detectBinaries(): Promise<BinariesStatus>
  checkWhisper(p: string): Promise<{ ok: boolean; message?: string }>

  // 长任务
  transcribe(
    jobId: string,
    videoPath: string,
    language: string
  ): Promise<{ tokens: Token[]; rawSegments: RawSegment[]; language: string; modelPath: string }>
  burn(req: {
    jobId: string
    videoPath: string
    cues: Array<{ text: string; start: number; end: number }>
    css: string
    outPath: string
  }): Promise<string>
  cancelJob(jobId: string): Promise<boolean>

  // 事件
  onJobEvent(cb: (e: JobEvent) => void): () => void
  onMenuAction(cb: (action: string) => void): () => void
}
