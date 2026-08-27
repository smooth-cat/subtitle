import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Cue } from '../../../shared/types'

export default function VideoPlayer({
  src,
  videoRef,
  activeCue,
  onTime,
  onError,
  onLoadedMetadata,
  transcoding,
  fileName
}: {
  src: string | null
  videoRef: RefObject<HTMLVideoElement | null>
  activeCue: Cue | null
  onTime: (ms: number) => void
  onError: () => void
  onLoadedMetadata: () => void
  transcoding: boolean
  fileName?: string
}) {
  const rafRef = useRef(0)

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
      <div className="player-stage">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime * 1000)}
            onError={onError}
            onLoadedMetadata={onLoadedMetadata}
            onClick={(e) => {
              const v = e.currentTarget
              if (v.paused) void v.play()
              else v.pause()
            }}
          />
        ) : (
          <div className="player-placeholder">
            <div className="ph-icon">🎬</div>
            <div>拖入视频文件，或点击「打开视频」</div>
            <div className="ph-sub">支持 h264 / h265（h265 无法硬解时自动转码预览副本）</div>
          </div>
        )}
        {lines.length > 0 && (
          <div className="cue-overlay">
            {lines.map((l, i) => (
              <div key={i} className="cue-overlay-line">
                {l}
              </div>
            ))}
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
