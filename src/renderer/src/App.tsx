import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cue, JobEvent, JobKind, ModelStatus, RecentEntry, Settings, SubProject } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { CueDraft } from '../../shared/core/assemble'
import { assembleCues, buildSentences, cuesToSrt, findActiveCue, padCueText } from '../../shared/core'
import { aiWindowTimeRange } from '../../shared/core/ai'
import { api, newJobId, fmtTime } from './lib'
import Toolbar from './components/Toolbar'
import VideoPlayer from './components/VideoPlayer'
import SidePane from './components/SidePane'
import { DEFAULT_SUBTITLE_CSS, normalizeSubtitleCss } from '../../shared/subtitleStyle'
import StatusBar from './components/StatusBar'
import SettingsDialog from './components/SettingsDialog'
import AiDialog from './components/AiDialog'

const VIDEO_EXT_RE = /\.(mp4|m4v|mkv|webm|mov|avi|ts|flv|wmv)$/i

interface JobState {
  kind: JobKind
  percent: number
  message?: string
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [project, setProject] = useState<SubProject | null>(null)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [usingPreview, setUsingPreview] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [jobs, setJobs] = useState<Record<string, JobState>>({})
  const [dialog, setDialog] = useState<'settings' | 'ai' | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [modelStatus, setModelStatus] = useState<ModelStatus | undefined>()
  const [toastMsg, setToastMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [styleTab, setStyleTab] = useState(false)
  const [cssDraft, setCssDraft] = useState<string | null>(null)
  const [previewRatio, setPreviewRatio] = useState({ w: 16, h: 9, label: '16:9' })
  const [fps, setFps] = useState(30)

  const videoRef = useRef<HTMLVideoElement>(null)
  const dirtyRef = useRef(false)
  const fallbackTriedRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToastMsg({ kind, text })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), kind === 'error' ? 6000 : 3000)
  }, [])

  // ─── 初始化 ──────────────────────────────────────────────────
  useEffect(() => {
    void api.getSettings().then((s) => {
      setSettings(s)
      setCssDraft((d) => d ?? normalizeSubtitleCss(s.subtitleCss))
    })
    void api.validateModel().then(setModelStatus)
    void api.recentProjects().then(setRecents)
  }, [])

  // ─── 工程自动保存 ────────────────────────────────────────────
  useEffect(() => {
    if (!project || !dirtyRef.current) return
    const t = window.setTimeout(() => {
      void api.saveProject(project)
      dirtyRef.current = false
    }, 700)
    return () => window.clearTimeout(t)
  }, [project])

  const mutateProject = useCallback((fn: (p: SubProject) => SubProject) => {
    dirtyRef.current = true
    setProject((prev) => (prev ? fn(prev) : prev))
  }, [])

  const saveNow = useCallback(() => {
    if (!project) return
    dirtyRef.current = false
    void api.saveProject(project).then(() => toast('工程已保存'))
  }, [project, toast])

  // ─── 任务进度 ────────────────────────────────────────────────
  useEffect(() => {
    const off = api.onJobEvent((e: JobEvent) => {
      setJobs((prev) => {
        const cur = prev[e.jobId] ?? { kind: e.kind, percent: 0, message: e.message }
        return {
          ...prev,
          [e.jobId]: { ...cur, percent: e.percent ?? cur.percent, message: e.message ?? cur.message }
        }
      })
    })
    return off
  }, [])

  const beginJob = useCallback((jobId: string, kind: JobKind, message: string) => {
    setJobs((prev) => ({ ...prev, [jobId]: { kind, percent: 0, message } }))
  }, [])

  const endJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  const cancelJob = useCallback(
    (jobId: string) => {
      void api.cancelJob(jobId)
    },
    []
  )

  // ─── 打开视频 ────────────────────────────────────────────────
  const openVideoPath = useCallback(
    async (p: string) => {
      try {
        const { project: loaded } = await api.loadForVideo(p)
        if (!loaded) return
        fallbackTriedRef.current = false
        pendingSeekRef.current = null
        setUsingPreview(false)
        setProject(loaded)
        setVideoSrc(await api.mediaUrl(loaded.video.path))
        setCurrentTime(0)
        // 探测真实帧率（逐帧步进步长），失败兜底 30fps
        void api
          .probeVideo(p)
          .then((r) => setFps(r.fps && r.fps > 0 ? r.fps : 30))
          .catch(() => setFps(30))
        void api.recentProjects().then(setRecents)
        toast(`已打开：${loaded.video.name}（工程 ${loaded.cues.length} 条字幕）`)
      } catch (err) {
        toast(`打开视频失败：${String((err as Error).message ?? err)}`, 'error')
      }
    },
    [toast]
  )

  const openVideoDialog = useCallback(async () => {
    const res = await api.openVideoDialog()
    if (res) await openVideoPath(res.path)
  }, [openVideoPath])

  // ─── 最近打开：删除记录（可选连字幕工程文件）──────────────────
  const deleteRecent = useCallback(
    async (id: string, deleteProject: boolean) => {
      await api.removeRecent(id, deleteProject)
      setRecents(await api.recentProjects())
      toast(deleteProject ? '已删除最近记录与字幕工程文件' : '已从最近列表移除')
    },
    [toast]
  )

  // ─── 拖拽（.gguf → 模型；视频 → 打开）────────────────────────
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      for (const f of files) {
        const p = api.getPathForFile(f)
        if (/\.(gguf|bin)$/i.test(p)) {
          void (async () => {
            const st = await api.validateModel(p)
            if (!st.exists) {
              toast('模型文件无效', 'error')
              return
            }
            const cur = await api.getSettings()
            const next = await api.setSettings({ ...cur, modelPath: p })
            setSettings(next)
            setModelStatus(st)
            toast(
              st.ggufValid
                ? '模型已置入 ✔'
                : '模型路径已记录（⚠ 文件头不是 GGUF，可能不是 whisper.cpp 模型）'
            )
          })()
        } else if (VIDEO_EXT_RE.test(p)) {
          void openVideoPath(p)
        }
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openVideoPath, toast])

  // ─── 视频播放兜底：h265 等无法硬解 → ffmpeg 转 h264 预览 ──────
  const handleVideoError = useCallback(() => {
    if (!project || fallbackTriedRef.current || usingPreview) return
    fallbackTriedRef.current = true
    // 记住出错时的播放位置，预览副本就绪后跳回
    const v = videoRef.current
    if (v && v.currentTime > 0) pendingSeekRef.current = Math.round(v.currentTime * 1000)
    const jobId = newJobId()
    beginJob(jobId, 'transcode', '正在生成 h264 预览副本…')
    void api
      .transcodePreview(jobId, project.video.path)
      .then(async (previewPath) => {
        setVideoSrc(await api.mediaUrl(previewPath))
        setUsingPreview(true)
        toast('当前格式无法直接播放，已转码 h264 预览副本')
      })
      .catch((err) => toast(`转码失败：${String((err as Error).message ?? err)}`, 'error'))
      .finally(() => endJob(jobId))
  }, [project, usingPreview, beginJob, endJob, toast])

  // 预览副本加载完元数据后，恢复出错前的播放位置
  const handleLoadedMetadata = useCallback(() => {
    if (pendingSeekRef.current != null && videoRef.current) {
      videoRef.current.currentTime = pendingSeekRef.current / 1000
      setCurrentTime(pendingSeekRef.current)
      pendingSeekRef.current = null
    }
  }, [])

  // ─── 转写 ────────────────────────────────────────────────────
  const startTranscribe = useCallback(() => {
    if (!project || !settings) return
    const jobId = newJobId()
    beginJob(jobId, 'transcribe', '准备转写…')
    void api
      .transcribe(jobId, project.video.path, settings.language)
      .then((res) => {
        const sentences = buildSentences(res.tokens)
        const drafts = assembleCues(sentences, settings.assemble)
        const cues: Cue[] = drafts.map((d) => ({
          id: crypto.randomUUID(),
          text: d.text,
          start: d.start,
          end: d.end,
          tokenStart: d.tokenStart,
          tokenEnd: d.tokenEnd,
          source: 'local'
        }))
        mutateProject((p) => ({
          ...p,
          tokens: res.tokens,
          rawSegments: res.rawSegments,
          language: res.language,
          cues,
          assemble: settings.assemble
        }))
        toast(`转写完成：${res.rawSegments.length} 段原始转写 → ${cues.length} 条字幕`)
      })
      .catch((err) => toast(`转写失败：${String((err as Error).message ?? err)}`, 'error'))
      .finally(() => endJob(jobId))
  }, [project, settings, beginJob, endJob, mutateProject, toast])

  // ─── 重新断句 ────────────────────────────────────────────────
  const reassemble = useCallback(() => {
    if (!project || !settings) return
    if (!project.tokens.length) {
      toast('还没有词级时间戳，请先转写', 'error')
      return
    }
    if (!window.confirm('将按当前断句设置重新生成全部字幕条，现有手动编辑会被覆盖。继续？')) return
    const sentences = buildSentences(project.tokens)
    const drafts = assembleCues(sentences, settings.assemble)
    const cues: Cue[] = drafts.map((d) => ({
      id: crypto.randomUUID(),
      text: d.text,
      start: d.start,
      end: d.end,
      tokenStart: d.tokenStart,
      tokenEnd: d.tokenEnd,
      source: 'local'
    }))
    mutateProject((p) => ({ ...p, cues, assemble: settings.assemble }))
    toast(`重新断句完成：${cues.length} 条字幕`)
  }, [project, settings, mutateProject, toast])

  // ─── 字幕增删改 ──────────────────────────────────────────────
  const updateCue = useCallback(
    (id: string, patch: Partial<Cue>) => {
      mutateProject((p) => ({
        ...p,
        cues: p.cues
          .map((c) => (c.id === id ? { ...c, ...patch, source: 'manual' as const } : c))
          .sort((a, b) => a.start - b.start)
      }))
    },
    [mutateProject]
  )

  const deleteCue = useCallback(
    (id: string) => {
      mutateProject((p) => ({ ...p, cues: p.cues.filter((c) => c.id !== id) }))
    },
    [mutateProject]
  )

  const addCue = useCallback(
    (atMs: number) => {
      if (!project) return
      const cue: Cue = {
        id: crypto.randomUUID(),
        text: '',
        start: Math.round(atMs),
        end: Math.round(atMs + 2000),
        tokenStart: -1,
        tokenEnd: -1,
        source: 'manual'
      }
      mutateProject((p) => ({
        ...p,
        cues: [...p.cues, cue].sort((a, b) => a.start - b.start)
      }))
      toast('已新增字幕条（手动）')
    },
    [project, mutateProject, toast]
  )

  // ─── AI 断句导入 ─────────────────────────────────────────────
  const importAiCues = useCallback(
    (drafts: CueDraft[]) => {
      const range = aiWindowTimeRange(drafts)
      const tokStart = drafts[0].tokenStart
      const tokEnd = drafts[drafts.length - 1].tokenEnd
      mutateProject((p) => {
        const kept = p.cues.filter((c) => {
          const tokenOverlap = c.tokenStart >= 0 && c.tokenStart < tokEnd && c.tokenEnd > tokStart
          const timeOverlap = c.end > range.from && c.start < range.to
          return !(tokenOverlap || timeOverlap)
        })
        const cues: Cue[] = drafts.map((d) => ({
          id: crypto.randomUUID(),
          text: d.text,
          start: d.start,
          end: d.end,
          tokenStart: d.tokenStart,
          tokenEnd: d.tokenEnd,
          source: 'ai'
        }))
        return { ...p, cues: [...kept, ...cues].sort((a, b) => a.start - b.start) }
      })
    },
    [mutateProject]
  )

  // ─── 字幕样式预览占位（取最长的一句 cue，无 cue 时用默认样例）───
  const placeholderCueText = useMemo(() => {
    const pad = settings?.assemble.padSpacing ?? false
    let best = ''
    for (const c of project?.cues ?? []) {
      if (c.text.trim().length > best.length) best = c.text
    }
    return padCueText(best || '字幕样式预览：这一行用来查看字号、描边与背景板效果 Sample 123', pad)
  }, [project, settings])

  // ─── 字幕样式保存 ────────────────────────────────────────────
  const saveCss = useCallback(
    async (css: string) => {
      if (!settings) return
      const next = await api.setSettings({ ...settings, subtitleCss: css })
      setSettings(next)
      setCssDraft(css)
    },
    [settings]
  )

  // ─── 导出 / 烧录 ─────────────────────────────────────────────
  const exportSrt = useCallback(async () => {
    if (!project?.cues.length) return
    const target = await api.saveFileDialog({
      defaultName: `${project.name}.srt`,
      filters: [{ name: 'SRT 字幕', extensions: ['srt'] }]
    })
    if (!target) return
    await api.writeTextFile(target, cuesToSrt(project.cues, { padSpacing: settings?.assemble.padSpacing ?? false }))
    toast(`已导出 SRT：${target}`)
  }, [project, settings, toast])

  const burn = useCallback(async () => {
    if (!project?.cues.length || !settings) return
    const outPath = await api.saveDirDialog({ defaultName: `${project.name}.字幕版.mp4` })
    if (!outPath) return
    const jobId = newJobId()
    beginJob(jobId, 'burn', '正在烧录字幕…')
    try {
      await api.burn({
        jobId,
        videoPath: project.video.path,
        cues: project.cues.map((c) => ({
          text: padCueText(c.text, settings.assemble.padSpacing),
          start: c.start,
          end: c.end
        })),
        css: settings.subtitleCss,
        outPath
      })
      toast(`烧录完成：${outPath}`)
      void api.showInFolder(outPath)
    } catch (err) {
      toast(`烧录失败：${String((err as Error).message ?? err)}`, 'error')
    } finally {
      endJob(jobId)
    }
  }, [project, settings, beginJob, endJob, toast])

  // ─── 菜单 / 快捷键 ───────────────────────────────────────────
  useEffect(() => {
    const off = api.onMenuAction((action) => {
      if (action === 'open-video') void openVideoDialog()
      if (action === 'save') saveNow()
    })
    return off
  }, [openVideoDialog, saveNow])

  // ─── 派生状态 ────────────────────────────────────────────────
  const activeCue = useMemo(
    () => (project ? findActiveCue(project.cues, currentTime) : null),
    [project, currentTime]
  )
  const transcribing = Object.values(jobs).some((j) => j.kind === 'transcribe')

  const seek = useCallback((ms: number) => {
    const v = videoRef.current
    if (v) v.currentTime = ms / 1000
    setCurrentTime(Math.round(ms))
  }, [])

  // 逐帧步进：先自动暂停，步长 = n/fps（n 为可编辑的步进帧数，兜底 1）；显式 setCurrentTime 同步字幕
  const frameStep = settings?.frameStep ?? DEFAULT_SETTINGS.frameStep
  const stepFrame = useCallback(
    (dir: 1 | -1) => {
      const v = videoRef.current
      if (!v || !v.duration || !Number.isFinite(v.duration)) return
      v.pause()
      const n = Math.max(1, dir === 1 ? frameStep.forward : frameStep.backward)
      const step = (1 / (fps > 0 ? fps : 30)) * n
      const next = Math.min(Math.max(0, v.currentTime + dir * step), v.duration)
      v.currentTime = next
      setCurrentTime(Math.round(next * 1000))
    },
    [fps, frameStep]
  )

  // 修改 ±n 帧步进帧数（控制栏内编辑，立即持久化到 settings.json）
  const setFrameStep = useCallback(
    (dir: 1 | -1, value: number) => {
      if (!settings) return
      const n = Math.max(1, Math.min(100, Math.round(value) || 1))
      const cur = settings.frameStep ?? DEFAULT_SETTINGS.frameStep
      const key = dir === 1 ? ('forward' as const) : ('backward' as const)
      if (cur[key] === n) return
      const next = { ...settings, frameStep: { ...cur, [key]: n } }
      void api.setSettings(next).then(setSettings)
    },
    [settings]
  )

  // ─── 播放快捷键 ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const v = videoRef.current
      if (!v) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seek(Math.max(0, v.currentTime * 1000 - 5000))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seek(v.currentTime * 1000 + 5000)
      } else if (e.code === 'Comma') {
        e.preventDefault()
        stepFrame(-1)
      } else if (e.code === 'Period') {
        e.preventDefault()
        stepFrame(1)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow, seek, stepFrame])

  return (
    <div className="app">
      <Toolbar
        projectName={project?.video.name}
        hasProject={!!project}
        hasCues={!!project?.cues.length}
        hasTokens={!!project?.tokens.length}
        modelStatus={modelStatus}
        transcribing={transcribing}
        recents={recents}
        currentProjectId={project?.id}
        onOpenVideo={() => void openVideoDialog()}
        onOpenRecent={(p) => void openVideoPath(p)}
        onDeleteRecent={(id, del) => void deleteRecent(id, del)}
        onTranscribe={startTranscribe}
        onExportSrt={() => void exportSrt()}
        onBurn={() => void burn()}
        onAiDialog={() => setDialog('ai')}
        onReassemble={reassemble}
        onSettings={() => setDialog('settings')}
      />

      <div className="main">
        <VideoPlayer
          src={videoSrc}
          videoRef={videoRef}
          activeCue={activeCue}
          currentTime={currentTime}
          seek={seek}
          stepFrame={stepFrame}
          frameStep={frameStep}
          onFrameStepChange={setFrameStep}
          onTime={setCurrentTime}
          onError={handleVideoError}
          onLoadedMetadata={handleLoadedMetadata}
          transcoding={Object.values(jobs).some((j) => j.kind === 'transcode')}
          subtitleCss={settings?.subtitleCss ?? ''}
          styleEditing={styleTab && !videoSrc}
          previewRatio={previewRatio}
          cssDraft={cssDraft ?? ''}
          placeholderText={placeholderCueText}
          padSpacing={settings?.assemble.padSpacing ?? false}
          fileName={project ? (usingPreview ? `${project.video.name}（h264 预览副本）` : project.video.name) : undefined}
        />
        <SidePane
          cues={project?.cues ?? []}
          currentTime={currentTime}
          savedCss={settings?.subtitleCss ?? ''}
          styleTab={styleTab}
          onStyleTabChange={setStyleTab}
          cssDraft={cssDraft ?? ''}
          onCssDraftChange={setCssDraft}
          previewRatio={previewRatio}
          onPreviewRatioChange={setPreviewRatio}
          onSeek={seek}
          onUpdate={updateCue}
          onDelete={deleteCue}
          onAdd={addCue}
          onSaveCss={saveCss}
          notify={toast}
        />
      </div>

      <StatusBar
        jobs={jobs}
        onCancel={cancelJob}
        statusText={
          project
            ? `${project.video.name} · ${fmtTime(project.video.durationMs, false)} · ${project.cues.length} 条字幕`
            : '未打开视频'
        }
      />

      {dialog === 'settings' && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setDialog(null)}
          onSave={(s) => {
            setSettings(s)
            void api.validateModel().then(setModelStatus)
          }}
        />
      )}

      {dialog === 'ai' && project && (
        <AiDialog project={project} onClose={() => setDialog(null)} onImport={importAiCues} />
      )}

      {toastMsg && <div className={`toast ${toastMsg.kind}`}>{toastMsg.text}</div>}
    </div>
  )
}
