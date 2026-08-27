// 内嵌 localhost 静态媒体服务（标准 HTTP Range 支持）。
// 不再用自定义 protocol + Node 流转发：Chromium 对标准 http 媒体流的 seek/取消
// 处理是成熟的；自研 protocol 流在 seek 时会触发 MEDIA_ERR_DECODE（实测）。
import { createReadStream, promises as fsp } from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
}

function mimeFor(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'
}

let server: http.Server | null = null
let baseUrl = ''

export async function startMediaServer(): Promise<string> {
  if (baseUrl) return baseUrl
  const token = crypto.randomBytes(16).toString('hex')

  server = http.createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // 路径形如 /<token>/<绝对路径>，随机 token 防止其他进程枚举访问
    const prefix = `/${token}/`
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(403)
      res.end()
      return
    }
    const filePath = decodeURIComponent(url.pathname.slice(prefix.length))
    let st
    try {
      st = await fsp.stat(filePath)
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    if (!st.isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const mime = mimeFor(filePath)
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = m?.[1] ? parseInt(m[1], 10) : 0
      let end = m?.[2] ? parseInt(m[2], 10) : st.size - 1
      if (isNaN(start) || start < 0) start = 0
      if (isNaN(end) || end >= st.size) end = st.size - 1
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes'
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': String(st.size),
      'Accept-Ranges': 'bytes'
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(filePath).pipe(res)
  }

  await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}/${token}/`
  return baseUrl
}

export function mediaServerUrl(filePath: string): string {
  if (!baseUrl) throw new Error('media server not started')
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return baseUrl + encoded
}

export function stopMediaServer(): void {
  server?.close()
  server = null
  baseUrl = ''
}
