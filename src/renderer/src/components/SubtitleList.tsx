import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Cue } from '../../../shared/types'
import { findActiveCue } from '../../../shared/core'
import { fmtTime } from '../lib'
import TimeInput from './TimeInput'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 不区分大小写的全局替换（replacement 中的 $ 转义为字面量，避免 $&/$1 等特殊模式）
function replaceAllIC(text: string, query: string, replacement: string): string {
  if (!query) return text
  const safe = replacement.replace(/\$/g, '$$$$')
  return text.replace(new RegExp(escapeRegExp(query), 'gi'), safe)
}

// 把匹配的子文本包上 <mark>；isCurrent 的匹配用更显眼的高亮
function renderHighlighted(text: string, query: string, isCurrent: boolean): ReactNode {
  if (!query.trim()) return text
  const re = new RegExp(escapeRegExp(query.trim()), 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <mark key={key++} className={isCurrent ? 'current' : ''}>
        {m[0]}
      </mark>
    )
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  parts.push(text.slice(last))
  return parts
}

export default function SubtitleList({
  cues,
  currentTime,
  autoScroll,
  onSeek,
  onUpdate,
  onDelete
}: {
  cues: Cue[]
  currentTime: number
  autoScroll: boolean
  onSeek: (ms: number) => void
  onUpdate: (id: string, patch: Partial<Cue>) => void
  onDelete: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [pointer, setPointer] = useState(0)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  // 正在编辑正文的卡片：搜索筛选时保持可见，避免编辑导致失配时卡片在打字中消失
  const [editingId, setEditingId] = useState<string | null>(null)
  // Enter 已把视频带到当前匹配（armed）：再次 Enter 才前进到下一条
  const armedRef = useRef(false)

  const q = query.trim().toLowerCase()
  const searching = q !== ''

  // 搜索筛选：只显示匹配的 cue（编辑中的卡片始终保留）
  const visible = useMemo(
    () =>
      searching
        ? cues.filter((c) => c.id === editingId || c.text.toLowerCase().includes(q))
        : cues,
    [cues, searching, q, editingId]
  )

  // 搜索词变化 → 重置勾选与指针
  useEffect(() => {
    setExcluded(new Set())
    setPointer(0)
    armedRef.current = false
  }, [q])

  // 指针越界钳制（替换/筛选导致匹配集缩小后仍指向有效项）
  useEffect(() => {
    if (pointer > visible.length - 1) setPointer(Math.max(0, visible.length - 1))
  }, [visible.length, pointer])

  const activeCue = findActiveCue(cues, currentTime)
  // 当前播放 cue 在筛选集中的位置（不在筛选集内则不显示高亮、不滚动）
  const activeVisibleIndex = activeCue ? visible.indexOf(activeCue) : -1
  const activeRef = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  // 非筛选态的最近滚动位置：退出搜索时恢复到这里，而不是跳到当前激活项
  const lastBrowseScrollRef = useRef(0)
  const prevSearchingRef = useRef(false)

  // 指针推进（Enter / 替换此条）时：当前匹配卡片不在视口内 → 滚动到容器中央
  useEffect(() => {
    if (!searching) return
    const container = bodyRef.current
    const el = currentRef.current
    if (!container || !el) return
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const fullyVisible = eRect.top >= cRect.top && eRect.bottom <= cRect.bottom
    if (fullyVisible) return
    const target =
      container.scrollTop +
      (eRect.top - cRect.top) -
      (container.clientHeight - el.offsetHeight) / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointer, q])

  useEffect(() => {
    if (autoScroll && !userScrolled.current && activeVisibleIndex >= 0 && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeVisibleIndex, autoScroll])

  // 退出筛选：恢复进入搜索前的浏览位置（先于被动效果执行，
  // 并短暂置 userScrolled 抑制紧随其后的“跟随播放”自动滚动）
  useLayoutEffect(() => {
    const container = bodyRef.current
    const wasSearching = prevSearchingRef.current
    prevSearchingRef.current = searching
    if (!container || !wasSearching || searching) return
    container.scrollTop = lastBrowseScrollRef.current
    userScrolled.current = true
    window.setTimeout(() => (userScrolled.current = false), 800)
  }, [searching])

  const checkedCount = visible.filter((c) => !excluded.has(c.id)).length
  const currentCue = visible[Math.min(pointer, visible.length - 1)]
  const currentExcluded = currentCue ? excluded.has(currentCue.id) : false

  // 替换当前指针所指 cue 内的全部匹配，随后指针自然落在下一条匹配上
  const replaceCurrent = (): void => {
    const cue = currentCue
    if (!cue || !q) return
    const next = replaceAllIC(cue.text, query.trim(), replaceText)
    if (next !== cue.text) onUpdate(cue.id, { text: next })
  }

  // 全部替换：仅作用于勾选的 cue
  const replaceAll = (): void => {
    const targets = visible.filter((c) => !excluded.has(c.id))
    if (!targets.length || !q) return
    if (targets.length > 50 && !window.confirm(`即将替换 ${targets.length} 条字幕中的匹配文本，继续？`)) return
    for (const c of targets) {
      const next = replaceAllIC(c.text, query.trim(), replaceText)
      if (next !== c.text) onUpdate(c.id, { text: next })
    }
  }

  // 反选：勾选 ⇄ 不勾选（仅在筛选出的匹配集内反转）
  const invertChecked = (): void => {
    const next = new Set(excluded)
    for (const c of visible) {
      if (next.has(c.id)) next.delete(c.id)
      else next.add(c.id)
    }
    setExcluded(next)
  }

  const sourceLabel: Record<Cue['source'], string> = {
    local: '本地',
    ai: 'AI',
    manual: '手动'
  }

  return (
    <>
      {/* 搜索面板位于滚动列表之外（flex 布局固定在列表顶部）：
          不用 sticky 内嵌——粘性面板会遮挡第一条，导致首项居中/滚动失效 */}
      <div className="search-panel">
        <div className="search-field">
          <input
            className="search-input"
            placeholder="搜索（不区分大小写，Enter 下一条）"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // 输入法组合中（拼音选词的 Enter / 取消组合的 Esc）：属于 IME 操作
              if (e.nativeEvent.isComposing) return
              if ((e.key === 'Enter' || e.key === 'ArrowDown') && visible.length) {
                e.preventDefault()
                const cur = Math.min(pointer, visible.length - 1)
                // 与手动点击卡片一致：先把视频带到当前高亮的匹配；
                // 已经带到（armed）再按 Enter 则前进到下一个
                const p = armedRef.current ? (cur + 1) % visible.length : cur
                armedRef.current = true
                setPointer(p)
                onSeek(visible[p].start)
              }
              if (e.key === 'Escape') {
                setQuery('')
                setReplaceText('')
              }
            }}
          />
          {query && (
            <button className="search-clear" title="清空" onClick={() => setQuery('')}>
              ✕
            </button>
          )}
        </div>
        <div className="search-tools">
          {searching && (
            <span className="search-count">
              {Math.min(pointer + 1, visible.length)} / {visible.length}
            </span>
          )}
        </div>
        <div className="search-field">
          <input
            className="search-input"
            placeholder="替换为（留空 = 删除匹配文本）"
            value={replaceText}
            spellCheck={false}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          {replaceText && (
            <button className="search-clear" title="清空" onClick={() => setReplaceText('')}>
              ✕
            </button>
          )}
        </div>
        <div className="search-actions">
          <button
            className="btn small"
            disabled={!visible.length || currentExcluded}
            title={
              currentExcluded
                ? '当前项未被勾选为替换项（点击其勾选框以启用）'
                : '替换当前匹配条中的全部匹配'
            }
            onClick={replaceCurrent}
          >
            替换此条
          </button>
          <button
            className="btn small"
            disabled={!visible.length || checkedCount === 0}
            title={`替换勾选的 ${checkedCount} 条`}
            onClick={replaceAll}
          >
            全部替换
          </button>
          <button className="btn ghost small" title="反转勾选（勾选 = 将被替换）" onClick={invertChecked}>
            反选
          </button>
        </div>
      </div>
      <div
        className="list-body"
        ref={bodyRef}
        onScroll={(e) => {
          // 只在非筛选态记录，作为退出搜索时的恢复点
          if (!searching) lastBrowseScrollRef.current = e.currentTarget.scrollTop
        }}
        onWheel={() => {
          userScrolled.current = true
          window.setTimeout(() => (userScrolled.current = false), 800)
        }}
      >
      {visible.length === 0 && (
        <div className="list-empty">{searching ? '没有匹配的字幕条' : '还没有字幕。打开视频后点击「转写」开始。'}</div>
      )}
        {visible.map((c, row) => {
          const active = c === activeCue
          const isCurrent = searching && row === Math.min(pointer, visible.length - 1)
          return (
            <div
              key={c.id}
              ref={(el) => {
                // 同一卡片可能既是播放位又是当前匹配：两个 ref 都要挂上
                if (c === activeCue) activeRef.current = el
                if (isCurrent) currentRef.current = el
              }}
              className={`cue-card ${active ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
              onClick={() => {
                // 拖选文本时不触发跳转
                if (window.getSelection()?.toString()) return
                // 与搜索 Enter 一致：点击同步当前匹配指针（计数/高亮跟随）
                if (searching) {
                  setPointer(row)
                  armedRef.current = true
                }
                onSeek(c.start)
              }}
            >
              <div className="cue-head">
                {searching && (
                  <input
                    type="checkbox"
                    className="cue-check"
                    title="勾选 = 全部替换时替换此条"
                    checked={!excluded.has(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = new Set(excluded)
                      if (e.target.checked) next.delete(c.id)
                      else next.add(c.id)
                      setExcluded(next)
                    }}
                  />
                )}
                <span className="cue-index">{cues.indexOf(c) + 1}</span>
                <span className={`badge badge-${c.source}`}>{sourceLabel[c.source]}</span>
                <span className="cue-times">
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
              <div className="cue-text-wrap">
                <div className="cue-text-highlight" aria-hidden="true">
                  {renderHighlighted(c.text, searching ? q : '', isCurrent)}
                </div>
                <textarea
                  className="cue-text"
                  value={c.text}
                  spellCheck={false}
                  onFocus={() => setEditingId(c.id)}
                  onBlur={() => setEditingId((id) => (id === c.id ? null : id))}
                  onChange={(e) => onUpdate(c.id, { text: e.target.value })}
                  placeholder="字幕文本（换行即分行显示）"
                />
              </div>
              <div className="cue-meta">
                {fmtTime(c.end - c.start, false)}
                {c.tokenStart < 0 ? '' : ' · 已映射词级时间戳'}
              </div>
            </div>
          )
        })}
    </div>
    </>
  )
}
