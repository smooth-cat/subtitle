import { useEffect, useState } from 'react'
import type { ModelStatus, RecentEntry } from '../../../shared/types'
import { api, fmtSize } from '../lib'
import Modal from './Modal'

export default function Toolbar({
  projectName,
  hasProject,
  hasCues,
  hasTokens,
  modelStatus,
  transcribing,
  recents,
  currentProjectId,
  onOpenVideo,
  onOpenRecent,
  onDeleteRecent,
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
  currentProjectId?: string
  onOpenVideo: () => void
  onOpenRecent: (videoPath: string) => void
  onDeleteRecent: (id: string, deleteProject: boolean) => void
  onTranscribe: () => void
  onExportSrt: () => void
  onBurn: () => void
  onAiDialog: () => void
  onReassemble: () => void
  onSettings: () => void
}) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RecentEntry | null>(null)
  const [fileInfo, setFileInfo] = useState<{ path: string; exists: boolean; sizeBytes: number } | null>(null)

  // 删除确认弹窗打开时查询工程文件信息
  useEffect(() => {
    if (!deleteTarget) {
      setFileInfo(null)
      return
    }
    let alive = true
    void api.projectFileInfo(deleteTarget.id).then((info) => {
      if (alive) setFileInfo(info)
    })
    return () => {
      alive = false
    }
  }, [deleteTarget])

  const modelOk = modelStatus?.exists
  const modelText = modelOk
    ? `模型已置入${modelStatus.sizeBytes ? ` · ${fmtSize(modelStatus.sizeBytes)}` : ''}`
    : '模型未置入'

  const doDelete = async (withProject: boolean): Promise<void> => {
    if (!deleteTarget) return
    await onDeleteRecent(deleteTarget.id, withProject)
    setDeleteTarget(null)
    setRecentOpen(false)
  }

  return (
    <div className="toolbar">
      <div className="brand">Subtitle Studio</div>

      <button className="btn" onClick={onOpenVideo}>
        打开视频
      </button>

      <div className="recent-wrap">
        <button
          className={`btn ${recentOpen ? 'active' : ''}`}
          onClick={() => setRecentOpen((o) => !o)}
        >
          最近打开 ▾
        </button>
        {recentOpen && (
          <>
            <div className="popover-backdrop" onClick={() => setRecentOpen(false)} />
            <div className="recent-panel">
              {recents.length === 0 && <div className="recent-empty">暂无最近打开记录</div>}
              {recents.map((r) => (
                <div
                  key={r.id}
                  className="recent-item"
                  onClick={() => {
                    setRecentOpen(false)
                    onOpenRecent(r.videoPath)
                  }}
                >
                  <div className="ri-main">
                    <div className="ri-name">{r.name}</div>
                    <div className="ri-date">{new Date(r.updatedAt).toLocaleString()}</div>
                  </div>
                  <button
                    className="ri-del"
                    title="从最近列表移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(r)
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

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

      {deleteTarget && (
        <Modal title="删除最近打开" onClose={() => setDeleteTarget(null)}>
          <div className="del-body">
            <div className="del-name">{deleteTarget.name}</div>
            <div className="hint">视频：{deleteTarget.videoPath}</div>
            <div className="hint" style={{ marginTop: 8 }}>
              字幕工程文件：
            </div>
            <div className="del-file">
              {fileInfo ? fileInfo.path : '…'}
              {fileInfo?.exists ? `（${fmtSize(fileInfo.sizeBytes)}）` : '（文件不存在）'}
            </div>
            {currentProjectId && deleteTarget.id === currentProjectId && (
              <div className="hint warn-hint" style={{ marginTop: 8 }}>
                该工程正在使用中：仅可移除记录，不能删除工程文件。
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className="btn"
                onClick={() => void doDelete(false)}
                title="仅从最近列表移除，保留字幕工程文件"
              >
                仅移除记录
              </button>
              <button
                className="btn danger"
                disabled={currentProjectId === deleteTarget.id}
                title={
                  currentProjectId === deleteTarget.id
                    ? '该工程正在使用中，不能删除'
                    : '从最近列表移除，并删除对应字幕工程文件（不可恢复）'
                }
                onClick={() => void doDelete(true)}
              >
                连同字幕工程文件删除
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
