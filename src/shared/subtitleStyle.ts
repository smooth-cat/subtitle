// 字幕样式单一来源：一段 CSS 同时驱动预览（DOM）与烧录（离屏渲染 PNG）。
// 作用对象：
//   .cue-overlay —— 字幕容器（位于视频内容区域内，绝对定位于底部）
//   .cue-line    —— 每一行字幕
// 可用变量：--vh 视频内容高度(px)、--vw 视频内容宽度(px)。
// CSS 会在预览窗口尺寸与烧录视频原始分辨率两种环境下渲染，
// 因此字号/间距请基于 var(--vh)/var(--vw) 换算以保持相对一致（默认样式已示范）。
// 注意：仅支持静态样式；动画/过渡在烧录的静态截帧中无意义。

export const DEFAULT_SUBTITLE_CSS = `/* 字幕样式（CSS）。对象：.cue-overlay 容器 / .cue-line 每行 */
.cue-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--vh) * 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--vh) * 0.004);
}

.cue-line {
  background: rgba(0, 0, 0, 0.72);
  color: #ffffff;
  font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: calc(var(--vh) * 0.0185);
  font-weight: 500;
  line-height: 1.45;
  padding: 0.12em 0.55em;
  border-radius: calc(var(--vh) * 0.004);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}`

export function normalizeSubtitleCss(css: string | undefined): string {
  const c = (css ?? '').trim()
  return c || DEFAULT_SUBTITLE_CSS
}
