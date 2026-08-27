import { useEffect, useRef, useState } from 'react'
import type { Cue } from '../../../shared/types'
import { findActiveCue } from '../../../shared/core'
import { fmtTime } from '../lib'
import TimeInput from './TimeInput'

export default function SubtitleList({
  cues,
  currentTime,
  onSeek,
  onUpdate,
  onDelete,
  onAdd
}: {
  cues: Cue[]
  currentTime: number
  onSeek: (ms: number) => void
  onUpdate: (id: string, patch: Partial<Cue>) => void
  onDelete: (id: string) => void
  onAdd: (atMs: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeCue = findActiveCue(cues, currentTime)
  const activeIndex = activeCue ? cues.indexOf(activeCue) : -1
  const activeRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const userScrolled = useRef(false)

  useEffect(() => {
    if (autoScroll && !userScrolled.current && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeIndex, autoScroll])

  const sourceLabel: Record<Cue['source'], string> = {
    local: '本地',
    ai: 'AI',
    manual: '手动'
  }

  return (
    <div className="list-pane">
      <div className="list-header">
        <span className="list-title">字幕条（{cues.length}）</span>
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
      </div>
      <div
        className="list-body"
        ref={listRef}
        onWheel={() => {
          userScrolled.current = true
          window.setTimeout(() => (userScrolled.current = false), 800)
        }}
      >
        {cues.length === 0 && (
          <div className="list-empty">还没有字幕。打开视频后点击「转写」开始。</div>
        )}
        {cues.map((c, i) => {
          const active = i === activeIndex
          return (
            <div
              key={c.id}
              ref={active ? activeRef : undefined}
              className={`cue-card ${active ? 'active' : ''}`}
              onClick={() => onSeek(c.start)}
            >
              <div className="cue-head">
                <span className="cue-index">{i + 1}</span>
                <span className={`badge badge-${c.source}`} onClick={(e) => e.stopPropagation()}>
                  {sourceLabel[c.source]}
                </span>
                <span className="cue-times" onClick={(e) => e.stopPropagation()}>
                  <TimeInput
                    value={c.start}
                    onCommit={(ms) => onUpdate(c.id, { start: ms })}
                  />
                  <span className="sep">→</span>
                  <TimeInput value={c.end} onCommit={(ms) => onUpdate(c.id, { end: ms })} />
                </span>
                <button
                  className="btn ghost small cue-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(c.id)
                  }}
                >
                  🗑
                </button>
              </div>
              <textarea
                className="cue-text"
                value={c.text}
                rows={2}
                spellCheck={false}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onUpdate(c.id, { text: e.target.value })}
                placeholder="字幕文本（换行即分行显示）"
              />
              <div className="cue-meta">
                {fmtTime(c.end - c.start, false)}
                {c.tokenStart < 0 ? '' : ' · 已映射词级时间戳'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
