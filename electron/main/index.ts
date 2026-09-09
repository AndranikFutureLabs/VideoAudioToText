import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { runTranscriptionPipeline, ensureModels } from './pipeline'
import { getFfmpegPathSafe, downloadFfmpeg } from './ffmpeg'
import { isWhisperReady, isWhisperDownloading, isWhisperCached, clearWhisperCache } from './whisper'
import { openFolder } from './platform'
import { checkPythonDeps } from './python_deps'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow() {
  const devIcon = join(__dirname, '../../logo.jpg')
  const prodIcon = join(process.resourcesPath || '', 'logo.jpg')
  const iconPath = existsSync(devIcon) ? devIcon : prodIcon
  const iconImage = nativeImage.createFromPath(iconPath)

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'VideoAudioToText',
    backgroundColor: '#111827',
    icon: iconImage,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, ...args: any[]) {
  mainWindow?.webContents.send(channel, ...args)
}

function setupIpc() {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Выберите видео или аудио файл',
      filters: [
        { name: 'Video & Audio', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma'] },
        { name: 'All', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled) return null
    const p = result.filePaths[0]
    const { statSync } = require('fs')
    const stats = statSync(p)
    return { path: p, name: p.split(/[\\/]/).pop(), size: stats.size }
  })

  ipcMain.handle('models:check', () => {
    const pyDeps = checkPythonDeps()
    return {
      whisper: isWhisperReady(),
      whisperCached: isWhisperCached(),
      whisperDownloading: isWhisperDownloading(),
      ffmpeg: getFfmpegPathSafe(),
      python: pyDeps.python,
      pythonVersion: pyDeps.pythonVersion,
      pythonCompatible: pyDeps.pythonCompatible,
      pythonDeps: pyDeps.fasterWhisper
    }
  })

  ipcMain.handle('models:load', async () => {
    try {
      await ensureModels(
        (msg) => send('pipeline:log', msg),
        (pct) => send('models:progress', pct)
      )
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.on('pipeline:start', async (_, payload) => {
    try {
      send('pipeline:log', '[1/3] Извлечение аудио...')
      send('pipeline:progress', 0.2)

      const result = await runTranscriptionPipeline(
        payload.inputPath,
        payload.sourceLang,
        payload.targetLang,
        (msg) => send('pipeline:log', msg),
        (pct) => send('pipeline:progress', pct)
      )

      send('pipeline:done', { success: true, outputDir: result.outputDir, files: result.files })
    } catch (err: any) {
      send('pipeline:done', { success: false, error: err.message })
    }
  })

  ipcMain.handle('ffmpeg:check', () => {
    return getFfmpegPathSafe()
  })

  ipcMain.handle('ffmpeg:download', async () => {
    try {
      await downloadFfmpeg((msg) => send('pipeline:log', msg))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('app:openFile', async (_, filePath: string) => {
    const result = await shell.openPath(filePath)
    if (result) send('pipeline:log', `⚠️ Не удалось открыть файл: ${result}`)
  })

  ipcMain.handle('app:openFolder', async (_, folderPath: string) => {
    try {
      openFolder(folderPath)
    } catch (e: any) {
      const result = await shell.openPath(folderPath)
      if (result) send('pipeline:log', `⚠️ Не удалось открыть папку: ${result}`)
    }
  })

  ipcMain.handle('app:openLink', (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('cache:clear', () => {
    clearWhisperCache()
    send('pipeline:log', '🧹 Кэш моделей очищен')
    return { success: true }
  })
}

app.whenReady().then(() => {
  try {
    const userData = app.getPath('userData')
    const versionFile = join(userData, '.app-version')
    const currentVersion = app.getVersion()
    if (existsSync(versionFile)) {
      const prevVersion = require('fs').readFileSync(versionFile, 'utf-8').trim()
      if (prevVersion !== currentVersion) {
        const tempDir = join(userData, 'temp')
        if (existsSync(tempDir)) {
          try { require('fs').rmSync(tempDir, { recursive: true, force: true }) } catch {}
        }
        const ffmpegDir = join(userData, 'ffmpeg-bin')
        if (existsSync(ffmpegDir)) {
          try { require('fs').rmSync(ffmpegDir, { recursive: true, force: true }) } catch {}
        }
      }
    }
    require('fs').writeFileSync(versionFile, currentVersion, 'utf-8')
  } catch {}

  createWindow()
  setupIpc()

  const devIcon = join(__dirname, '../../logo.jpg')
  const prodIcon = join(process.resourcesPath || '', 'logo.jpg')
  const iconPath = existsSync(devIcon) ? devIcon : prodIcon
  const iconImage = nativeImage.createFromPath(iconPath)
  if (!iconImage.isEmpty()) {
    tray = new Tray(iconImage.resize({ width: 16, height: 16 }))
    tray.setToolTip('VideoAudioToText')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() }
    ]))
    tray.on('click', () => mainWindow?.show())
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  setTimeout(async () => {
    if (!getFfmpegPathSafe() || isWhisperReady()) return
    const whisperCached = isWhisperCached()
    if (whisperCached) {
      send('pipeline:log', '✅ Модель в кэше. Нажмите «Загрузить модели» перед запуском.')
      return
    }
    send('pipeline:log', '🔄 Автозагрузка моделей...')
    send('models:progress', 0.05)
    try {
      await ensureModels(
        (msg) => send('pipeline:log', msg),
        (pct) => send('models:progress', pct)
      )
      send('models:loaded', true)
    } catch (err: any) {
      send('pipeline:log', `⚠️ Автозагрузка: ${err.message}`)
    }
  }, 1000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
