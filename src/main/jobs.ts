import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { JobEvent, JobKind } from '../shared/types'

const jobs = new Map<string, ChildProcess>()

export function sendJob(event: JobEvent): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    win.webContents.send('job:event', event)
  }
}

export function sendProgress(jobId: string, kind: JobKind, percent?: number, message?: string): void {
  sendJob({ jobId, kind, percent, message })
}

export function registerJob(jobId: string, child: ChildProcess): void {
  jobs.set(jobId, child)
}

export function cancelJob(jobId: string): boolean {
  const child = jobs.get(jobId)
  if (!child) return false
  jobs.delete(jobId)
  try {
    child.kill('SIGKILL')
  } catch {
    // ignore
  }
  return true
}

export function cancelAllJobs(): void {
  for (const [, child] of jobs) {
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
  jobs.clear()
}

export function unregisterJob(jobId: string): void {
  jobs.delete(jobId)
}

// 子进程包装：收集 stderr 尾部日志用于报错，stdout 交给回调（ffmpeg -progress）
export function runProcess(
  jobId: string,
  kind: JobKind,
  bin: string,
  args: string[],
  opts: {
    cwd?: string
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    registerJob(jobId, child)
    let stderrTail = ''
    let settled = false

    child.stdout?.on('data', (d: Buffer) => opts.onStdout?.(d.toString()))
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      stderrTail = (stderrTail + s).slice(-4000)
      opts.onStderr?.(s)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      unregisterJob(jobId)
      reject(new Error(`无法启动 ${bin}: ${err.message}`))
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      unregisterJob(jobId)
      if (code === 0) {
        resolve()
      } else if (signal === 'SIGKILL') {
        reject(new Error('任务已取消'))
      } else {
        reject(new Error(`${path.basename(bin)} 退出码 ${code}\n${stderrTail.trim().split('\n').slice(-6).join('\n')}`))
      }
    })
  })
}
