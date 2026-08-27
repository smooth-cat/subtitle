import type { ModelStatus, RecentEntry } from '../../../shared/types'
import { fmtSize } from '../lib'

export default function Toolbar({
  projectName,
  hasProject,
  hasCues,
  hasTokens,
  modelStatus,
  transcribing,
  recents,
  onOpenVideo,
  onOpenRecent,
  onTranscribe,
  onExportSrt,
  onBurn,
  onAiDialog,
  onReassemble,
  onSettings
}: {
  projectName?: string
  hasProject: boolean
  hasCues: boolean
  hasTokens: boolean
  modelStatus?: ModelStatus
  transcribing: boolean
  recents: RecentEntry[]
  onOpenVideo: () => void
  onOpenRecent: (videoPath: string) => void
  onTranscribe: () => void
  onExportSrt: () => void
  onBurn: () => void
  onAiDialog: () => void
  onReassemble: () => void
  onSettings: () => void
}) {
  const modelOk = modelStatus?.exists
  const modelText = modelOk
    ? `模型已置入${modelStatus.sizeBytes ? ` · ${fmtSize(modelStatus.sizeBytes)}` : ''}`
    : '模型未置入'

  return (
    <div className="toolbar">
      <div className="brand">Subtitle Studio</div>

      <button className="btn" onClick={onOpenVideo}>
        打开视频
      </button>

      <select
        className="recent-select"
        value=""
        onChange={(e) => {
          if (e.target.value) onOpenRecent(e.target.value)
        }}
      >
        <option value="">最近打开…</option>
        {recents.map((r) => (
          <option key={r.id} value={r.videoPath}>
            {r.name}（{new Date(r.updatedAt).toLocaleDateString()}）
          </option>
        ))}
      </select>

      <div className="tb-group">
        <button className="btn primary" disabled={!hasProject || transcribing} onClick={onTranscribe}>
          {transcribing ? '转写中…' : '转写'}
        </button>
        <button className="btn" disabled={!hasTokens} onClick={onReassemble} title="按当前断句设置重新生成全部字幕条">
          重新断句
        </button>
        <button className="btn" disabled={!hasCues} onClick={onAiDialog} title="导出待断句文本 / 粘贴导入 AI 断句结果">
          AI 断句
        </button>
      </div>

      <div className="tb-group">
        <button className="btn" disabled={!hasCues} onClick={onExportSrt}>
          导出 SRT
        </button>
        <button className="btn" disabled={!hasCues} onClick={onBurn}>
          烧录合成
        </button>
      </div>

      <div className="toolbar-spacer" />

      <button
        className={`btn model-badge ${modelOk ? 'ok' : 'warn'}`}
        onClick={onSettings}
        title={modelOk ? modelStatus?.path : '点击打开设置，拖入或选择 large-v3-turbo gguf 模型文件'}
      >
        <span className={`dot ${modelOk ? 'ok' : 'warn'}`} />
        {modelText}
      </button>
      <button className="btn" onClick={onSettings}>
        设置
      </button>
      {projectName && <div className="proj-name" title={projectName}>{projectName}</div>}
    </div>
  )
}
