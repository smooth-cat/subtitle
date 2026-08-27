import { app, BrowserWindow, Menu } from 'electron'
import path from 'node:path'
import { startMediaServer, stopMediaServer } from './protocol'
import { registerIpc } from './ipc'
import { cancelAllJobs } from './jobs'

let mainWindow: BrowserWindow | null = null

function sendMenuAction(action: string): void {
  mainWindow?.webContents.send('menu:action', action)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '文件',
      submenu: [
        {
          label: '打开视频…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open-video')
        },
        {
          label: '保存工程',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: 'Subtitle Studio · 视频字幕工具',
    backgroundColor: '#15161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await startMediaServer()
  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  cancelAllJobs()
  stopMediaServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
