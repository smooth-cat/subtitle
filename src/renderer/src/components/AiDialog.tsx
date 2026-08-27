import { useState } from 'react'
import type { SubProject } from '../../../shared/types'
import { buildAiExport, parseAiImport, type AiImportResult } from '../../../shared/core/ai'
import type { CueDraft } from '../../../shared/core/assemble'
import { api, fmtSize, fmtTime, parseTimeInput } from '../lib'
import Modal from './Modal'

export default function AiDialog({
  project,
  onClose,
  onImport
}: {
  project: SubProject
  onClose: () => void
  onImport: (drafts: CueDraft[]) => void
}) {
  const [fromText, setFromText] = useState(fmtTime(0, false))
  const [toText, setToText] = useState(fmtTime(project.video.durationMs, false))
  const [pasted, setPasted] = useState('')
  const [result, setResult] = useState<AiImportResult | null>(null)

  const hasRaw = project.rawSegments.length > 0

  const range = (): { from: number; to: number } | undefined => {
    const from = parseTimeInput(fromText)
    const to = parseTimeInput(toText)
    if (from == null && to == null) return undefined
    return { from: from ?? 0, to: to ?? project.video.durationMs }
  }

  const doExport = () => {
    return buildAiExport(project.rawSegments, range())
  }

  const copyPrompt = async () => {
    const { prompt } = doExport()
    await api.copyToClipboard(prompt)
  }

  const exportFile = async () => {
    const { fileText } = doExport()
    const target = await api.saveFileDialog({
      defaultName: `${project.name}.待断句.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    })
    if (target) await api.writeTextFile(target, fileText)
  }

  const tryImport = () => {
    const r = parseAiImport(pasted, project.rawSegments, project.tokens, project.assemble)
    setResult(r)
    if (r.ok) onImport(r.cues)
  }

  const rawSize = project.rawSegments.reduce((a, r) => a + r.text.length, 0)

  return (
    <Modal title="AI 断句（兜底：导出文本 → 交给任意 AI → 粘贴回导入）" onClose={onClose} wide>
      <div className="ai-dialog">
        <section>
          <h3>1. 导出待断句文本（每行一条原始转写，#序号 标记）</h3>
          {!hasRaw ? (
            <div className="hint warn-hint">还没有转写数据，请先完成「转写」。</div>
          ) : (
            <>
              <div className="field-row">
                <label>时间范围（可选）</label>
                <input
                  className="time-input"
                  value={fromText}
                  onChange={(e) => setFromText(e.target.value)}
                  placeholder="0:00"
                />
                <span>→</span>
                <input
                  className="time-input"
                  value={toText}
                  onChange={(e) => setToText(e.target.value)}
                  placeholder={fmtTime(project.video.durationMs, false)}
                />
                <span className="hint">
                  原始转写 {project.rawSegments.length} 段 / {fmtSize(rawSize)}
                </span>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={() => void copyPrompt()}>
                  复制提示词模板（含文本）
                </button>
                <button className="btn" onClick={() => void exportFile()}>
                  导出文本文件
                </button>
              </div>
              <div className="hint">
                将复制的提示词粘贴给任意 AI，让它只插入换行、不改任何文字；拿到结果后粘贴到下方。
              </div>
            </>
          )}
        </section>

        <section>
          <h3>2. 粘贴 AI 返回的结果</h3>
          <textarea
            className="paste-area"
            rows={8}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value)
              setResult(null)
            }}
            placeholder="粘贴 AI 处理后的文本（每行一个完整句子）…"
            spellCheck={false}
          />
          <div className="btn-row">
            <button
              className="btn primary"
              disabled={!hasRaw || !pasted.trim()}
              onClick={tryImport}
            >
              校验并导入
            </button>
            <span className="hint">导入会替换对应时间范围内的现有字幕条（逐字校验不通过则拒绝）。</span>
          </div>
        </section>

        {result && (
          <section className={`ai-result ${result.ok ? 'ok' : 'fail'}`}>
            {result.ok ? (
              <>
                <div className="ai-result-title">✔ 校验通过，已导入 {result.cues.length} 条字幕</div>
                {result.warnings.length > 0 && (
                  <ul className="warn-list">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="ai-result-title">✘ {result.message}</div>
                {result.diff && (
                  <div className="diff-box">
                    <div>
                      原文： <code>{result.diff.expected}</code>
                    </div>
                    <div>
                      AI 返回：<code>{result.diff.got}</code>
                    </div>
                    <div className="hint">首个差异位于第 {result.diff.index} 个字符附近</div>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
