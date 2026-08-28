// CSS 字幕烧录管线：
// 预览（DOM + CSS）与烧录共用同一份样式。烧录时：
// 1. 隐藏透明 BrowserWindow（offscreen, deviceScaleFactor=1）按视频原始分辨率，
//    逐条渲染 cue → capturePage(内容 bbox) → 小尺寸透明 PNG（相同文本去重）
// 2. 单次 ffmpeg：N 个 overlay 滤镜（position + enable=between(t,start,end)）
//    时间轴精确到毫秒，无中间容器量化；窗口外不混合、不驻留大内存。
// 注意：enable 窗口外 overlay 仍持有各自的小帧（bbox 尺寸），4K+ 数百条字幕
// 场景内存约 1~2GB，属已知边界。
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SUBTITLE_CSS } from '../shared/subtitleStyle'
import { runProcess } from './jobs'
import { resolveFfmpeg } from './binaries'
import { makeProgressParser } from './ffmpeg'

export interface CssBurnOptions {
  jobId: string
  videoPath: string
  cues: Array<{ text: string; start: number; end: number }>
  css: string
  width: number
  height: number
  workDir: string
  outPath: string
  ffmpegPath?: string
  durationSec: number
  keepWorkDir?: boolean
  onProgress: (percent: number, message?: string) => void
  isCancelled?: () => boolean
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeCss(css: string): string {
  // 防止用户 CSS 提前闭合 <style> 标签
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

function buildPage(width: number, height: number, css: string): string {
  const base = sanitizeCss(DEFAULT_SUBTITLE_CSS)
  const user = sanitizeCss(css)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
:root{--vh:${height}px;--vw:${width}px}
#stage{position:relative;width:${width}px;height:${height}px;background:transparent}
${base}
</style><style>
${user}
</style></head><body><div id="stage"><div class="cue-overlay"></div></div></body></html>`
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function createRenderWindow(width: number, height: number, css: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      transparent: true,
      backgroundThrottling: false,
      // offscreen 截帧 1:1（部分版本类型定义缺失，运行时仍生效）
      ...( { deviceScaleFactor: 1 } as Record<string, unknown> )
    } as Electron.WebPreferences
  })
  await withTimeout(
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPage(width, height, css))),
    20_000,
    '加载渲染页面'
  )
  await withTimeout(win.webContents.executeJavaScript('document.fonts.ready.then(() => true)'), 10_000, '等待字体')
  return win
}

interface CueImage {
  file: string
  x: number
  y: number
}

// 截取单条字幕：整帧截取 → 按 DPR 自校正 → NativeImage.crop 裁出内容 bbox。
// 注意：offscreen 模式下 capturePage 的 rect 参数会被忽略（返回整帧），
// 且 Retina 屏幕截帧为 2x 物理像素，因此必须自行检测 DPR 并换算坐标。
async function captureCue(
  win: BrowserWindow,
  overlayHtml: string,
  frameW: number,
  frameH: number,
  scale: { dpr: number },
  outFile: string
): Promise<CueImage> {
  const wc = win.webContents
  await withTimeout(
    wc.executeJavaScript(`document.querySelector('.cue-overlay').innerHTML = ${JSON.stringify(overlayHtml)}`),
    10_000,
    '设置字幕内容'
  )
  await withTimeout(
    wc.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
    10_000,
    '等待布局'
  )
  const img = await withTimeout(wc.capturePage(), 15_000, '截取字幕帧')
  // DPR 自校正：整帧图像宽 / 窗口 CSS 宽
  const trueDpr = img.getSize().width / frameW
  if (Math.abs(trueDpr - scale.dpr) > 0.01) scale.dpr = trueDpr
  const d = scale.dpr
  const rect = JSON.parse(
    await withTimeout(
      wc.executeJavaScript(`(() => {
        const r = document.querySelector('.cue-overlay').getBoundingClientRect()
        const pad = 8
        const x = Math.max(0, Math.floor(r.x - pad))
        const y = Math.max(0, Math.floor(r.y - pad))
        const w = Math.min(${frameW - 1}, Math.ceil(r.width + pad * 2))
        const h = Math.min(${frameH - 1}, Math.ceil(r.height + pad * 2))
        return JSON.stringify({ x, y, w: Math.max(2, w), h: Math.max(2, h) })
      })()`),
      10_000,
      '测量字幕区域'
    )
  ) as { x: number; y: number; w: number; h: number }
  // 先按 DPR 从整帧裁出内容，再缩回 CSS/视频像素尺寸——
  // 这样 overlay 的坐标与图层始终在同一（1x）坐标系，与视频分辨率无关
  const cropped = img
    .crop({
      x: Math.max(0, Math.min(Math.round(rect.x * d), img.getSize().width - 2)),
      y: Math.max(0, Math.min(Math.round(rect.y * d), img.getSize().height - 2)),
      width: Math.max(2, Math.round(rect.w * d)),
      height: Math.max(2, Math.round(rect.h * d))
    })
    .resize({ width: Math.round(rect.w), height: Math.round(rect.h) })
  fs.writeFileSync(outFile, cropped.toPNG())
  return { file: outFile, x: rect.x, y: rect.y }
}

// 渲染所有去重后的 cue → bbox 裁剪 PNG
async function renderCuePngs(opts: CssBurnOptions): Promise<Map<string, CueImage>> {
  const win = await createRenderWindow(opts.width, opts.height, opts.css)
  try {
    const pngs = new Map<string, CueImage>()
    const scale = { dpr: 1 }
    const uniqueTexts: string[] = []
    for (const c of opts.cues) {
      if (!pngs.has(c.text)) uniqueTexts.push(c.text)
    }
    let done = 0
    for (const text of uniqueTexts) {
      if (opts.isCancelled?.()) throw new Error('任务已取消')
      const html = text
        .split('\n')
        .map((l) => `<div class="cue-line">${escapeHtml(l)}</div>`)
        .join('')
      const file = path.join(opts.workDir, `cue-${String(pngs.size).padStart(5, '0')}.png`)
      const shoot = async (): Promise<CueImage> => {
        try {
          return await captureCue(win, html, opts.width, opts.height, scale, file)
        } catch (e) {
          // 重试一次：整页重载（规避 offscreen compositor 偶发停摆）
          await withTimeout(
            win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPage(opts.width, opts.height, opts.css))),
            20_000,
            '重载渲染页面'
          )
          await withTimeout(win.webContents.executeJavaScript('document.fonts.ready.then(() => true)'), 10_000, '等待字体')
          return captureCue(win, html, opts.width, opts.height, scale, file)
        }
      }
      pngs.set(text, await shoot())
      done += 1
      opts.onProgress((done / uniqueTexts.length) * 20, `正在渲染字幕图像 ${done}/${uniqueTexts.length}`)
    }
    return pngs
  } finally {
    win.destroy()
  }
}

function sec(ms: number): string {
  return (ms / 1000).toFixed(3)
}

function escFilter(s: string): string {
  return s.replace(/,/g, '\\,').replace(/'/g, "\\'")
}

export async function burnWithCss(opts: CssBurnOptions): Promise<string> {
  const bin = await resolveFfmpeg(opts.ffmpegPath)
  if (!bin) throw new Error('未找到 ffmpeg，请安装 ffmpeg 或在设置中指定路径')
  const cues = opts.cues.filter((c) => c.text.trim() && c.end > c.start)
  if (!cues.length) throw new Error('没有可烧录的字幕')

  // 阶段 1：渲染 PNG（0 ~ 20%）
  const t0 = Date.now()
  const stageLog = (msg: string) => console.error(`[cssBurn] +${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`)
  const pngs = await renderCuePngs(opts)
  stageLog(`rendered ${pngs.size - 0} unique cue images`)

  // 阶段 2：单次 ffmpeg，N 个 overlay（位置 + enable 时间窗）
  const args: string[] = ['-y', '-i', opts.videoPath]
  const chains: string[] = []
  let prev = '0:v'
  let idx = 1
  for (const c of cues) {
    const img = pngs.get(c.text)
    if (!img) continue
    args.push('-i', img.file)
    const out = `s${idx}`
    const enable = escFilter(`between(t,${sec(c.start)},${sec(c.end)})`)
    chains.push(
      `[${prev}][${idx}:v]overlay=x=${img.x}:y=${img.y}:format=auto:enable='${enable}'[${out}]`
    )
    prev = out
    idx += 1
  }
  args.push(
    '-filter_complex',
    chains.join(';'),
    '-map',
    `[${prev}]`,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    opts.outPath
  )
  opts.onProgress(20, '正在烧录字幕…')
  await runProcess(opts.jobId, 'burn', bin, args, {
    onStdout: makeProgressParser(opts.durationSec, (p) => opts.onProgress(20 + p * 0.8))
  })
  stageLog('final encode done')

  if (!opts.keepWorkDir) {
    try {
      fs.rmSync(opts.workDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  return opts.outPath
}
