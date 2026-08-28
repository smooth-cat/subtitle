import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { Api } from '../shared/api'
import type { JobEvent } from '../shared/types'

const api: Api = {
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  pickFile: (opts) => ipcRenderer.invoke('dialog:pickFile', opts),
  saveFileDialog: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  saveDirDialog: (opts) => ipcRenderer.invoke('dialog:saveDir', opts),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  showInFolder: (p) => ipcRenderer.invoke('app:showInFolder', p),
  copyToClipboard: (text) => ipcRenderer.invoke('app:copyToClipboard', text),
  writeTextFile: (p, content) => ipcRenderer.invoke('app:writeTextFile', p, content),

  mediaUrl: (filePath) => ipcRenderer.invoke('media:url', filePath),
  probeVideo: (videoPath) => ipcRenderer.invoke('media:probe', videoPath),
  transcodePreview: (jobId, videoPath) => ipcRenderer.invoke('media:transcodePreview', jobId, videoPath),

  loadForVideo: (videoPath) => ipcRenderer.invoke('project:loadForVideo', videoPath),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  removeRecent: (id, deleteProject) => ipcRenderer.invoke('project:removeRecent', id, deleteProject),
  projectFileInfo: (id) => ipcRenderer.invoke('project:fileInfo', id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  validateModel: (p) => ipcRenderer.invoke('model:validate', p),
  detectBinaries: () => ipcRenderer.invoke('binaries:detect'),
  checkWhisper: (p) => ipcRenderer.invoke('binaries:checkWhisper', p),

  transcribe: (jobId, videoPath, language) =>
    ipcRenderer.invoke('whisper:transcribe', jobId, videoPath, language),
  burn: (req) => ipcRenderer.invoke('burn:run', req),
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),

  onJobEvent: (cb) => {
    const handler = (_e: IpcRendererEvent, event: JobEvent) => cb(event)
    ipcRenderer.on('job:event', handler)
    return () => ipcRenderer.removeListener('job:event', handler)
  },
  onMenuAction: (cb) => {
    const handler = (_e: IpcRendererEvent, action: string) => cb(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
