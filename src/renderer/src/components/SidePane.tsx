import { useEffect, useMemo, useState } from 'react'
import type { Cue } from '../../../shared/types'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../../shared/subtitleStyle'
import SubtitleList from './SubtitleList'

type SideTab = 'cues' | 'style'

export default function SidePane({
  cues,
  currentTime,
  savedCss,
  styleTab,
  onStyleTabChange,
  cssDraft,
  onCssDraftChange,
  previewRatio,
  onPreviewRatioChange,
  onSeek,
  onUpdate,
  onDelete,
  onAdd,
  onSaveCss,
  notify
}: {
  cues: Cue[]
  currentTime: number
  savedCss: string
  styleTab: boolean
  onStyleTabChange: (active: boolean) => void
  cssDraft: string
  onCssDraftChange: (css: string) => void
  previewRatio: { w: number; h: number; label: string }
  onPreviewRatioChange: (r: { w: number; h: number; label: string }) => void
  onSeek: (ms: number) => void
  onUpdate: (id: string, patch: Partial<Cue>) => void
  onDelete: (id: string) => void
  onAdd: (atMs: number) => void
  onSaveCss: (css: string) => Promise<void>
  notify: (text: string, kind?: 'info' | 'error') => void
}) {
  const [autoScroll, setAutoScroll] = useState(true)
  const tab: SideTab = styleTab ? 'style' : 'cues'

  const saved = normalizeSubtitleCss(savedCss)
  const dirty = normalizeSubtitleCss(cssDraft) !== saved

  // 外部保存（或恢复默认）后同步草稿；草稿有未保存修改时不覆盖
  useEffect(() => {
    if (!dirty) onCssDraftChange(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCss])

  // 基础校验：能被浏览器样式表解析
  const cssError = useMemo(() => {
    if (!cssDraft.trim()) return null
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(cssDraft)
      return null
    } catch (e) {
      return String((e as Error).message ?? e)
    }
  }, [cssDraft])

  // 自动保存：草稿合法且与已保存不同 → 防抖后保存；不合法则不保存
  useEffect(() => {
    if (cssError) return
    const css = normalizeSubtitleCss(cssDraft)
    if (css === saved) return
    const timer = window.setTimeout(() => {
      void onSaveCss(css)
    }, 600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cssDraft, cssError, saved])

  const switchTab = (next: SideTab): void => {
    if (tab === next) return
    if (tab === 'style' && dirty) {
      if (cssError) {
        // 不合法的草稿无法保存：恢复到上一次保存的样式
        onCssDraftChange(saved)
        notify('CSS 不合法，已恢复上次保存的样式', 'error')
      } else {
        // 合法但还在防抖窗口内：立即保存
        const css = normalizeSubtitleCss(cssDraft)
        onCssDraftChange(css)
        void onSaveCss(css)
      }
    }
    onStyleTabChange(next === 'style')
  }

  return (
    <div className="list-pane">
      <div className="list-header">
        <div className="side-tabs">
          <button
            className={`side-tab ${tab === 'cues' ? 'active' : ''}`}
            onClick={() => switchTab('cues')}
          >
            字幕条{cues.length > 0 ? `（${cues.length}）` : ''}
          </button>
          <button
            className={`side-tab ${tab === 'style' ? 'active' : ''}`}
            onClick={() => switchTab('style')}
          >
            字幕样式
          </button>
        </div>
        {tab === 'cues' ? (
          <>
            <label className="chk">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              跟随播放
            </label>
            <button
              className="btn small"
              onClick={() => onAdd(currentTime)}
              title="在当前播放位置新增一条字幕"
            >
              ＋ 新增
            </button>
          </>
        ) : (
          <span className={`side-status ${cssError ? 'err' : ''}`}>
            {cssError ? 'CSS 错误 · 未保存' : dirty ? '自动保存中…' : '已保存 ✓'}
          </span>
        )}
      </div>

      {tab === 'cues' ? (
        <SubtitleList
          cues={cues}
          currentTime={currentTime}
          autoScroll={autoScroll}
          onSeek={onSeek}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ) : (
        <div className="style-body">
          <div className="preview-ratios">
            <span className="hint" style={{ marginRight: 'auto' }}>
              预览比例（在播放器区域查看）
            </span>
            {[
              { label: '16:9', w: 16, h: 9 },
              { label: '4:3', w: 4, h: 3 },
              { label: '1:1', w: 1, h: 1 },
              { label: '9:16', w: 9, h: 16 }
            ].map((r) => (
              <button
                key={r.label}
                className={`ratio-btn ${previewRatio.label === r.label ? 'active' : ''}`}
                onClick={() => onPreviewRatioChange(r)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            className="css-area"
            spellCheck={false}
            value={cssDraft}
            onChange={(e) => onCssDraftChange(e.target.value)}
          />
          {cssError ? (
            <div className="hint warn-hint">
              CSS 无法解析（不会保存，切走时自动恢复）：{cssError}
            </div>
          ) : (
            <div className="hint">
              作用对象：<code>.cue-overlay</code>（字幕容器）、<code>.cue-line</code>（每行字幕）。
              可用变量：<code>var(--vh)</code> / <code>var(--vw)</code>
              为视频内容高度/宽度（px），字号等请基于它们换算以保证预览与烧录一致（默认样式已示范）。
              仅支持静态样式。改动合法时自动保存。
            </div>
          )}
          <div className="btn-row">
            <button
              className="btn small"
              onClick={() => onCssDraftChange(DEFAULT_SUBTITLE_CSS)}
              title="载入默认样式（合法时将自动保存）"
            >
              恢复默认样式
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
