import { useEffect, useMemo, useState } from 'react'
import type { BinariesStatus, ModelStatus, Settings } from '../../../shared/types'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../../shared/subtitleStyle'
import { api } from '../lib'
import { fmtSize } from '../lib'
import Modal from './Modal'

const LANGS: Array<[string, string]> = [
  ['zh', '中文'],
  ['auto', '自动检测'],
  ['en', '英语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['yue', '粤语'],
  ['ru', '俄语'],
  ['es', '西班牙语'],
  ['fr', '法语'],
  ['de', '德语']
]

export default function SettingsDialog({
  settings,
  onClose,
  onSave
}: {
  settings: Settings
  onClose: () => void
  onSave: (s: Settings) => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [bins, setBins] = useState<BinariesStatus>({})
  const [dragOver, setDragOver] = useState(false)

  // 字幕 CSS 基础校验：能被浏览器样式表解析才允许保存
  const cssError = useMemo(() => {
    const css = draft.subtitleCss
    if (!css.trim()) return null
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(css)
      return null
    } catch (e) {
      return String((e as Error).message ?? e)
    }
  }, [draft.subtitleCss])

  useEffect(() => {
    void api.validateModel().then(setModelStatus)
    void api.detectBinaries().then(setBins)
  }, [])

  const refreshModel = (p?: string) => {
    void api.validateModel(p).then((st) => {
      setModelStatus(st)
      setDraft((d) => ({ ...d, modelPath: st.exists ? st.path : d.modelPath }))
    })
  }

  const setModelFile = async (p: string) => {
    await api.setSettings({ ...draft, modelPath: p })
    refreshModel(p)
  }

  const save = async () => {
    const next = await api.setSettings({ ...draft, subtitleCss: normalizeSubtitleCss(draft.subtitleCss) })
    onSave(next)
    onClose()
  }

  const pickBinary = async (key: 'whisperPath' | 'ffmpegPath' | 'ffprobePath') => {
    const p = await api.pickFile({ title: '选择可执行文件' })
    if (p) setDraft((d) => ({ ...d, [key]: p }))
  }

  return (
    <Modal title="设置" onClose={onClose} wide>
      <div className="settings">
        <section>
          <h3>Whisper 模型（large-v3-turbo gguf，约 1.6GB）</h3>
          <div
            className={`dropzone ${dragOver ? 'over' : ''} ${modelStatus?.exists ? 'has' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void setModelFile(api.getPathForFile(f))
            }}
            onClick={async () => {
              const p = await api.pickFile({
                title: '选择 gguf 模型文件',
                extensions: ['gguf', 'bin']
              })
              if (p) void setModelFile(p)
            }}
          >
            {modelStatus?.exists ? (
              <div>
                <div className="dz-title ok">✔ 已置入</div>
                <div className="dz-path">{modelStatus.path}</div>
                <div className="dz-sub">
                  {modelStatus.sizeBytes ? fmtSize(modelStatus.sizeBytes) : ''}
                  {modelStatus.ggufValid === false ? ' · ⚠ 文件头不是 GGUF 格式' : ''}
                </div>
                <div className="dz-sub">拖入新的模型文件可替换</div>
              </div>
            ) : (
              <div>
                <div className="dz-title">将模型文件拖到这里，或点击选择</div>
                <div className="dz-sub">
                  模型不随应用打包。请自行下载 whisper.cpp 的 ggml-large-v3-turbo gguf 模型
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3>程序路径</h3>
          <div className="field-row">
            <label>whisper-cli</label>
            <input
              value={draft.whisperPath ?? ''}
              placeholder={bins.whisper ? `自动检测：${bins.whisper}` : '未检测到，可手动指定'}
              onChange={(e) => setDraft((d) => ({ ...d, whisperPath: e.target.value || undefined }))}
            />
            <button className="btn small" onClick={() => void pickBinary('whisperPath')}>
              浏览
            </button>
            <span className={`dot ${bins.whisper ? 'ok' : 'warn'}`} title={bins.whisper ?? '未检测到'} />
          </div>
          <div className="field-row">
            <label>ffmpeg</label>
            <input
              value={draft.ffmpegPath ?? ''}
              placeholder={bins.ffmpeg ? `自动检测：${bins.ffmpeg}` : '未检测到，可手动指定'}
              onChange={(e) => setDraft((d) => ({ ...d, ffmpegPath: e.target.value || undefined }))}
            />
            <button className="btn small" onClick={() => void pickBinary('ffmpegPath')}>
              浏览
            </button>
            <span className={`dot ${bins.ffmpeg ? 'ok' : 'warn'}`} title={bins.ffmpeg ?? '未检测到'} />
          </div>
          <div className="field-row">
            <label>ffprobe</label>
            <input
              value={draft.ffprobePath ?? ''}
              placeholder={bins.ffprobe ? `自动检测：${bins.ffprobe}` : '未检测到，可手动指定'}
              onChange={(e) => setDraft((d) => ({ ...d, ffprobePath: e.target.value || undefined }))}
            />
            <button className="btn small" onClick={() => void pickBinary('ffprobePath')}>
              浏览
            </button>
            <span className={`dot ${bins.ffprobe ? 'ok' : 'warn'}`} title={bins.ffprobe ?? '未检测到'} />
          </div>
          <div className="hint">
            whisper.cpp 安装：brew install whisper-cpp；ffmpeg（含 ffprobe）：brew install
            ffmpeg。静态版 ffmpeg 可能不带 ffprobe，需单独放置或指定。
          </div>
        </section>

        <section>
          <h3>转写</h3>
          <div className="field-row">
            <label>语言</label>
            <select
              value={draft.language}
              onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
            >
              {LANGS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="hint">
            转写使用 whisper.cpp + Metal GPU 加速。视频编码（预览转码/烧录）实测 x264
            多线程在 Apple Silicon 上快于 VideoToolbox 硬编，故固定使用 x264。
          </div>
        </section>

        <section>
          <h3>断句 / 换行</h3>
          <div className="field-grid">
            <div className="field-row">
              <label>每行字数上限</label>
              <input
                type="number"
                min={4}
                max={40}
                value={draft.assemble.maxLineChars}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assemble: { ...d.assemble, maxLineChars: Number(e.target.value) || 16 }
                  }))
                }
              />
            </div>
            <div className="field-row">
              <label>最多行数</label>
              <input
                type="number"
                min={1}
                max={4}
                value={draft.assemble.maxLines}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assemble: { ...d.assemble, maxLines: Number(e.target.value) || 2 }
                  }))
                }
              />
            </div>
            <div className="field-row">
              <label>单条时长上限（秒）</label>
              <input
                type="number"
                min={1}
                max={30}
                value={draft.assemble.maxCueDurationMs / 1000}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assemble: {
                      ...d.assemble,
                      maxCueDurationMs: (Number(e.target.value) || 8) * 1000
                    }
                  }))
                }
              />
            </div>
            <div className="field-row">
              <label>句尾缓冲（秒）</label>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={draft.assemble.endBufferMs / 1000}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    assemble: {
                      ...d.assemble,
                      endBufferMs: (Number(e.target.value) || 0) * 1000
                    }
                  }))
                }
              />
            </div>
          </div>
          <div className="hint">修改后可点击工具栏「重新断句」，用词级时间戳重新生成全部字幕条。</div>
        </section>

        <section>
          <h3>字幕样式（CSS，预览与烧录共用）</h3>
          <textarea
            className="css-area"
            rows={12}
            spellCheck={false}
            value={draft.subtitleCss}
            onChange={(e) => setDraft((d) => ({ ...d, subtitleCss: e.target.value }))}
          />
          {cssError ? (
            <div className="hint warn-hint">CSS 无法解析：{cssError}</div>
          ) : (
            <div className="hint">
              作用对象：<code>.cue-overlay</code>（字幕容器）、<code>.cue-line</code>（每行字幕）。
              可用变量：<code>var(--vh)</code> / <code>var(--vw)</code>
              为视频内容高度/宽度（px），字号等请基于它们换算以保证预览与烧录一致（默认样式已示范）。
              仅支持静态样式。
            </div>
          )}
          <div className="btn-row">
            <button
              className="btn small"
              onClick={() => setDraft((d) => ({ ...d, subtitleCss: DEFAULT_SUBTITLE_CSS }))}
            >
              恢复默认样式
            </button>
          </div>
        </section>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!!cssError} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}
