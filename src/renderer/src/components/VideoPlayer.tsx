import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Cue } from '../../../shared/types'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../../shared/subtitleStyle'
import StylePreviewStage from './StylePreviewStage'

// 与烧录侧（cssBurn 渲染页）完全一致的 DOM 结构与样式注入方式：
// #stage(视频内容矩形) > .cue-overlay > .cue-line*N
// --vh/--vw 为视频内容高度/宽度(px)，用户 CSS 与默认 CSS 均基于它做分辨率无关换算。
export default function VideoPlayer({
  src,
  videoRef,
  activeCue,
  onTime,
  onError,
  onLoadedMetadata,
  transcoding,
  subtitleCss,
  styleEditing,
  previewRatio,
  cssDraft,
  placeholderText,
  fileName
}: {
  src: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  activeCue: Cue | null
  onTime: (ms: number) => void
  onError: () => void
  onLoadedMetadata: () => void
  transcoding: boolean
  subtitleCss: string
  styleEditing: boolean
  previewRatio: { w: number; h: number; label: string }
  cssDraft: string
  placeholderText: string
  fileName?: string
}) {
  const rafRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  // 视频画面在舞台内的实际显示矩形（object-fit: contain 去黑边计算）
  const [contentRect, setContentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const updateRect = () => {
    const v = videoRef.current
    const st = stageRef.current
    if (!v || !st || !v.videoWidth || !v.videoHeight) {
      setContentRect(null)
      return
    }
    const sw = st.clientWidth
    const sh = st.clientHeight
    const scale = Math.min(sw / v.videoWidth, sh / v.videoHeight)
    const w = v.videoWidth * scale
    const h = v.videoHeight * scale
    setContentRect({ x: (sw - w) / 2, y: (sh - h) / 2, w, h })
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

  const lines = activeCue ? activeCue.text.split('\n').filter((l) => l.trim()) : []

  return (
    <div className="player-pane">
      <div className="player-stage" ref={stageRef}>
        {src ? (
          <video
            ref={videoRef}
            src={src}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime * 1000)}
            onError={onError}
            onLoadedMetadata={() => {
              updateRect()
              onLoadedMetadata()
            }}
            onClick={(e) => {
              const v = e.currentTarget
              if (v.paused) void v.play()
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
        {transcoding && (
          <div className="player-tip">正在生成 h264 预览副本，完成后自动切换…</div>
        )}
      </div>
      {fileName && <div className="player-caption" title={fileName}>{fileName}</div>}
    </div>
  )
}
