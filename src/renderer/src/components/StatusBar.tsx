import type { JobEvent, JobKind } from '../../../shared/types'

const KIND_LABEL: Record<JobKind, string> = {
  wav: '抽取音频',
  transcode: '转码预览',
  transcribe: '转写',
  burn: '烧录字幕'
}

export default function StatusBar({
  jobs,
  onCancel,
  statusText
}: {
  jobs: Record<string, { kind: JobKind; percent: number; message?: string }>
  onCancel: (jobId: string) => void
  statusText?: string
}) {
  const entries = Object.entries(jobs)
  return (
    <div className="statusbar">
      <span className="status-text">{statusText}</span>
      {entries.map(([jobId, job]) => (
        <div className="status-job" key={jobId}>
          <span className="status-kind">{KIND_LABEL[job.kind]}</span>
          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(4, Math.min(100, job.percent))}%` }}
            />
          </div>
          <span className="status-pct">{job.percent != null ? `${Math.round(job.percent)}%` : ''}</span>
          {job.message && <span className="status-msg">{job.message}</span>}
          <button className="btn ghost small" onClick={() => onCancel(jobId)} title="取消">
            取消
          </button>
        </div>
      ))}
    </div>
  )
}
