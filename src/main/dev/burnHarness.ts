// CLI 验证工具（dev only）：直接驱动真实的 CSS 烧录管线，不经过 UI。
// 用法：electron out/harness --video <视频> --cues <cue数组json> --out <输出> [--css <css文件>] [--keep]
// 日志写入 /tmp/opencode/harness-debug.log（进程内同步写入，崩溃也不丢）。
import { app } from 'electron'
import fs from 'node:fs'
import { burnWithCss } from '../cssBurn'
import { probeVideo } from '../ffmpeg'
import { normalizeSubtitleCss } from '../../shared/subtitleStyle'
import { cacheDir } from '../settings'

const DEBUG_LOG = '/tmp/opencode/harness-debug.log'
function log(msg: string): void {
  const line = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}`
  try {
    fs.appendFileSync(DEBUG_LOG, line + '\n')
  } catch {
    // ignore
  }
  console.log(line)
}
const T0 = Date.now()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

app.whenReady().then(async () => {
  try {
    fs.writeFileSync(DEBUG_LOG, '')
    log('whenReady fired')
    // 关键：渲染窗口销毁会触发 window-all-closed，裸脚本默认行为会导致 app 退出
    app.on('window-all-closed', () => log('window-all-closed (ignored)'))
    app.on('before-quit', (e) => log('before-quit fired'))
    app.on('will-quit', (e) => log('will-quit fired'))
    app.on('render-process-gone', (_e, _wc, d) => log(`render-gone: ${JSON.stringify(d)}`))
    app.on('child-process-gone', (_e, d) => log(`child-gone: ${d.type} ${d.reason}`))
    const video = arg('video')
    const cuesFile = arg('cues')
    const out = arg('out')
    if (!video || !cuesFile || !out) throw new Error('用法: burn-harness --video X --cues Y --out Z [--css F] [--keep]')
    const cues = JSON.parse(fs.readFileSync(cuesFile, 'utf8')) as Array<{
      text: string
      start: number
      end: number
    }>
    log(`cues: ${cues.length}`)
    const cssFile = arg('css')
    const css = normalizeSubtitleCss(cssFile ? fs.readFileSync(cssFile, 'utf8') : undefined)
    log('probing video…')
    const probe = await probeVideo(video, {})
    log(`probe: ${probe.width}x${probe.height} ${probe.durationSec}s codec=${probe.videoCodec}`)
    const keep = process.argv.includes('--keep')
    const workDir = cacheDir('burn-harness', String(Date.now()))
    log(`workDir: ${workDir}`)
    await burnWithCss({
      jobId: `harness-${Date.now()}`,
      videoPath: video,
      cues,
      css,
      width: probe.width as number,
      height: probe.height as number,
      workDir,
      outPath: out,
      durationSec: probe.durationSec,
      keepWorkDir: keep,
      onProgress: (p, m) => log(`${Math.floor(p)}% ${m ?? ''}`)
    })
    log(`DONE → ${out}`)
  } catch (e) {
    log(`HARNESS FAILED: ${(e as Error).message}`)
    process.exitCode = 1
  } finally {
    app.quit()
    setTimeout(() => process.exit(process.exitCode ? 1 : 0), 500)
  }
})
