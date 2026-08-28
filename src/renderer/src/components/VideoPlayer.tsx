import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Cue, FrameStepSettings } from '../../../shared/types'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../../shared/subtitleStyle'
import { padLatinSpacing } from '../../../shared/core'
import { fmtTime } from '../lib'
import StylePreviewStage from './StylePreviewStage'

// 控制栏条带高度：贴视频下边缘、与视频同宽；与 styles.css 的 --ctrl-h 必须保持一致
const CTRL_BAR_H = 36

// 步进帧数输入框：草稿态允许临时非法值，合法值即时提交（持久化），失焦回弹为已提交值
function StepNumber({
  dir,
  value,
  onCommit
}: {
  dir: 1 | -1
  value: number
  onCommit: (dir: 1 | -1, value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      className="vc-step-input"
      type="number"
      min={1}
      max={100}
      title={dir === 1 ? '前进帧数' : '后退帧数'}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = Math.round(Number(e.target.value))
        if (Number.isFinite(n) && n >= 1) onCommit(dir, Math.min(100, n))
      }}
      onBlur={() => setDraft(String(value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

// 与烧录侧（cssBurn 渲染页）完全一致的 DOM 结构与样式注入方式：
// #stage(视频内容矩形) > .cue-overlay > .cue-line*N
// --vh/--vw 为视频内容高度/宽度(px)，用户 CSS 与默认 CSS 均基于它做分辨率无关换算。
export default function VideoPlayer({
  src,
  videoRef,
  activeCue,
  currentTime,
  seek,
  stepFrame,
  frameStep,
  onFrameStepChange,
  onTime,
  onError,
  onLoadedMetadata,
  transcoding,
  subtitleCss,
  styleEditing,
  previewRatio,
  cssDraft,
  placeholderText,
  padSpacing,
  fileName
}: {
  src: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  activeCue: Cue | null
  currentTime: number
  seek: (ms: number) => void
  stepFrame: (dir: 1 | -1) => void
  frameStep: FrameStepSettings
  onFrameStepChange: (dir: 1 | -1, value: number) => void
  onTime: (ms: number) => void
  onError: () => void
  onLoadedMetadata: () => void
  transcoding: boolean
  subtitleCss: string
  styleEditing: boolean
  previewRatio: { w: number; h: number; label: string }
  cssDraft: string
  placeholderText: string
  padSpacing: boolean
  fileName?: string
}) {
  const rafRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  // 视频画面在舞台内的实际显示矩形（object-fit: contain 去黑边计算）
  const [contentRect, setContentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // 控制栏 / 播放状态
  const [duration, setDuration] = useState<number | null>(null)
  const [paused, setPaused] = useState(true)
  const [flash, setFlash] = useState<{ seq: number } | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const holdTimer = useRef<number | undefined>(undefined)
  const repeatTimer = useRef<number | undefined>(undefined)

  const updateRect = () => {
    const v = videoRef.current
    const st = stageRef.current
    if (!v || !st || !v.videoWidth || !v.videoHeight) {
      setContentRect(null)
      return
    }
    const sw = st.clientWidth
    // 底部为控制栏预留条带（与 CSS max-height/margin-bottom 严格镜像），视频画面永不与控制栏重叠
    const sh = st.clientHeight - CTRL_BAR_H
    const scale = Math.min(sw / v.videoWidth, sh / v.videoHeight)
    const w = v.videoWidth * scale
    const h = v.videoHeight * scale
    setContentRect({ x: (sw - w) / 2, y: (st.clientHeight - CTRL_BAR_H - h) / 2, w, h })
  }

  useEffect(() => {
    const st = stageRef.current
    const v = videoRef.current
    const ro = new ResizeObserver(() => updateRect())
    if (st) ro.observe(st)
    window.addEventListener('resize', updateRect)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateRect)
      void v
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    const tick = () => {
      const v = videoRef.current
      if (v && !v.paused && !v.ended) onTime(v.currentTime * 1000)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 逐帧按钮按住连发：pointerdown 立即步进，400ms 后每 120ms 重复；松开/移出/取消即停
  const stopHold = () => {
    window.clearTimeout(holdTimer.current)
    window.clearInterval(repeatTimer.current)
    holdTimer.current = undefined
    repeatTimer.current = undefined
  }
  const startHold = (dir: 1 | -1) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    stepFrame(dir)
    stopHold()
    holdTimer.current = window.setTimeout(() => {
      repeatTimer.current = window.setInterval(() => stepFrame(dir), 120)
    }, 400)
  }

  // 窗口级兜底：指针在按钮外松开也要停止连发
  useEffect(() => {
    const up = () => stopHold()
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    stopHold()
    return () => window.clearTimeout(flashTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 换视频：重置时长与播放态
  useEffect(() => {
    setDuration(null)
    setPaused(true)
    setFlash(null)
  }, [src])

  const syncDuration = () => {
    const v = videoRef.current
    setDuration(v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null)
  }

  // 恢复播放 + 播放图标闪现反馈（动画由 key 变化重放）
  const playWithFlash = () => {
    const v = videoRef.current
    if (!v) return
    void v.play()
    setFlash({ seq: Date.now() })
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 550)
  }

  // 进度条仅点击跳转
  const onTrackClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    seek(p * duration * 1000)
  }

  // 预览与烧录一致：显示层实时补空格（不改 cue 原文本），空格不计每行字数上限
  const lines = activeCue
    ? activeCue.text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => (padSpacing ? padLatinSpacing(l) : l))
    : []

  const pct = duration && duration > 0 ? Math.min(100, Math.max(0, (currentTime / 1000 / duration) * 100)) : 0

  return (
    <div className="player-pane">
      <div className="player-stage" ref={stageRef}>
        {src ? (
          <video
            ref={videoRef}
            src={src}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime * 1000)}
            onError={onError}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={() => setPaused(true)}
            onDurationChange={syncDuration}
            onLoadedMetadata={() => {
              updateRect()
              syncDuration()
              onLoadedMetadata()
            }}
            onClick={(e) => {
              const v = e.currentTarget
              if (v.paused) playWithFlash()
              else v.pause()
            }}
          />
        ) : styleEditing ? (
          // 无视频 + 字幕样式编辑中：在播放器区域展示比例背景与占位字幕（草稿 CSS，iframe 隔离）
          <StylePreviewStage ratio={previewRatio} css={cssDraft} placeholderText={placeholderText} />
        ) : (
          <div className="player-placeholder">
            <div className="ph-icon">🎬</div>
            <div>拖入视频文件，或点击「打开视频」</div>
            <div className="ph-sub">支持 h264 / h265（h265 无法硬解时自动转码预览副本）</div>
          </div>
        )}
        {src && contentRect && (
          <div
            className="subtitle-render-root"
            style={
              {
                position: 'absolute',
                left: contentRect.x,
                top: contentRect.y,
                width: contentRect.w,
                height: contentRect.h,
                overflow: 'hidden',
                pointerEvents: 'none',
                background: 'transparent',
                '--vh': `${contentRect.h}px`,
                '--vw': `${contentRect.w}px`
              } as React.CSSProperties
            }
          >
            <style>{DEFAULT_SUBTITLE_CSS + '\n' + normalizeSubtitleCss(subtitleCss)}</style>
            {lines.length > 0 && (
              <div className="cue-overlay">
                {lines.map((l, i) => (
                  <div key={i} className="cue-line">
                    {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* 暂停时：视频内容区左下角悬浮「继续播放」按钮 */}
        {src && paused && contentRect && !transcoding && (
          <button
            type="button"
            className="resume-btn"
            title="继续播放"
            style={{ left: contentRect.x + 12, top: contentRect.y + contentRect.h - 12 - 44 }}
            onClick={playWithFlash}
          >
            ▶
          </button>
        )}
        {/* 恢复播放：播放图标闪现后消失 */}
        {flash && contentRect && (
          <div
            key={flash.seq}
            className="play-flash"
            style={{ left: contentRect.x, top: contentRect.y, width: contentRect.w, height: contentRect.h }}
          >
            <div className="play-flash-icon">▶</div>
          </div>
        )}
        {/* 控制栏：贴视频下边缘、与视频同宽，位于预留条带内（不进入视频画面） */}
        {src && contentRect && duration != null && (
          <div
            className="video-controls"
            style={{ left: contentRect.x, top: contentRect.y + contentRect.h, width: Math.max(contentRect.w, 380) }}
          >
            <span className="vc-time">{fmtTime(currentTime, false)}</span>
            <div className="vc-track" title="点击跳转" onClick={onTrackClick}>
              <div className="vc-fill" style={{ width: `${pct}%` }} />
              <div className="vc-thumb" style={{ left: `${pct}%` }} />
            </div>
            <span className="vc-time">{fmtTime(duration * 1000, false)}</span>
            {/* 逐帧步进：方向按钮与可编辑帧数分离，±n 各自持久化（快捷键 , / .） */}
            <div className="vc-step">
              <button
                type="button"
                className="vc-btn vc-dir"
                title={`后退 ${frameStep.backward} 帧（按住连发，快捷键 ,）`}
                onPointerDown={startHold(-1)}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
              >
                −
              </button>
              <StepNumber dir={-1} value={frameStep.backward} onCommit={onFrameStepChange} />
              <span className="vc-unit">帧</span>
              <StepNumber dir={1} value={frameStep.forward} onCommit={onFrameStepChange} />
              <button
                type="button"
                className="vc-btn vc-dir"
                title={`前进 ${frameStep.forward} 帧（按住连发，快捷键 .）`}
                onPointerDown={startHold(1)}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
              >
                +
              </button>
            </div>
          </div>
        )}
        {transcoding && (
          <div className="player-tip">正在生成 h264 预览副本，完成后自动切换…</div>
        )}
      </div>
      {fileName && <div className="player-caption" title={fileName}>{fileName}</div>}
    </div>
  )
}
