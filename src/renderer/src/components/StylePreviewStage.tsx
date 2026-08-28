// 字幕样式预览舞台：在 player-stage 中按所选比例渲染背景与占位字幕。
// 草稿 CSS 通过 iframe 隔离（不影响播放器的字幕浮层与其他功能）；
// 内部以 1080 虚拟高度渲染再 transform 缩放，观感与真实视频一致。
import { useCallback, useEffect, useRef } from 'react'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../../shared/subtitleStyle'

const VIRTUAL_H = 1080

const SRC_DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:linear-gradient(180deg,#31456b 0%,#1b2740 55%,#0c1322 100%);overflow:hidden}
:root{--vh:${VIRTUAL_H}px}
#stage{position:relative;transform-origin:top left}
${DEFAULT_SUBTITLE_CSS}
</style><style id="user-css"></style></head>
<body><div id="stage"><div class="cue-overlay"></div></div></body></html>`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function StylePreviewStage({
  ratio,
  css,
  placeholderText
}: {
  ratio: { w: number; h: number; label: string }
  css: string
  placeholderText: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)

  const sync = useCallback(() => {
    const frame = frameRef.current
    const wrap = wrapRef.current
    const doc = frame?.contentDocument
    if (!frame || !wrap || !doc || !doc.body) return
    const virtualW = Math.round((VIRTUAL_H * ratio.w) / ratio.h)
    const availW = Math.max(80, wrap.clientWidth - 24)
    const availH = Math.max(80, wrap.clientHeight - 24)
    const scale = Math.min(availW / virtualW, availH / VIRTUAL_H)
    scaleRef.current = scale
    frame.style.width = `${Math.round(virtualW * scale)}px`
    frame.style.height = `${Math.round(VIRTUAL_H * scale)}px`
    const rootEl = doc.documentElement
    rootEl.style.setProperty('--vh', `${VIRTUAL_H}px`)
    rootEl.style.setProperty('--vw', `${virtualW}px`)
    const stage = doc.getElementById('stage')
    if (stage) {
      stage.style.width = `${virtualW}px`
      stage.style.height = `${VIRTUAL_H}px`
      stage.style.transform = `scale(${scale})`
      stage.style.transformOrigin = 'top left'
    }
    const styleEl = doc.getElementById('user-css')
    if (styleEl) styleEl.textContent = normalizeSubtitleCss(css)
    const overlay = doc.querySelector('.cue-overlay')
    if (overlay) {
      overlay.innerHTML = placeholderText
        .split('\n')
        .map((l) => `<div class="cue-line">${escapeHtml(l)}</div>`)
        .join('')
    }
  }, [ratio, css, placeholderText])

  useEffect(() => {
    sync()
    const onResize = () => sync()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sync])

  return (
    <div className="style-preview-stage" ref={wrapRef}>
      <iframe ref={frameRef} title="字幕样式预览" srcDoc={SRC_DOC} onLoad={() => sync()} />
    </div>
  )
}
