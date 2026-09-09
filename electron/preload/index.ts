import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFile: () => ipcRenderer.invoke('dialog:openFile') as Promise<{ path: string; name: string; size: number } | null>,

  checkModels: () => ipcRenderer.invoke('models:check') as Promise<{
    whisper: boolean
    whisperCached: boolean
    whisperDownloading: boolean
    ffmpeg: string | null
    python: boolean
    pythonVersion: string
    pythonCompatible: boolean
    pythonDeps: boolean
  }>,

  loadModels: () => ipcRenderer.invoke('models:load') as Promise<{ success: boolean; error?: string }>,
  clearCache: () => ipcRenderer.invoke('cache:clear') as Promise<{ success: boolean }>,

  startPipeline: (payload: { inputPath: string; sourceLang: string; targetLang: string }) => {
    ipcRenderer.send('pipeline:start', payload)
  },

  checkFfmpeg: () => ipcRenderer.invoke('ffmpeg:check') as Promise<string | null>,
  downloadFfmpeg: () => ipcRenderer.invoke('ffmpeg:download') as Promise<{ success: boolean; error?: string }>,

  openFileResult: (filePath: string) => ipcRenderer.invoke('app:openFile', filePath),
  openFolder: (folderPath: string) => ipcRenderer.invoke('app:openFolder', folderPath),
  openLink: (url: string) => ipcRenderer.invoke('app:openLink', url),

  onPipelineLog: (callback: (msg: string) => void) => {
    const handler = (_: any, msg: string) => callback(msg)
    ipcRenderer.on('pipeline:log', handler)
    return () => ipcRenderer.removeListener('pipeline:log', handler)
  },

  onPipelineProgress: (callback: (pct: number) => void) => {
    const handler = (_: any, pct: number) => callback(pct)
    ipcRenderer.on('pipeline:progress', handler)
    return () => ipcRenderer.removeListener('pipeline:progress', handler)
  },

  onModelsProgress: (callback: (pct: number) => void) => {
    const handler = (_: any, pct: number) => callback(pct)
    ipcRenderer.on('models:progress', handler)
    return () => ipcRenderer.removeListener('models:progress', handler)
  },

  onPipelineDone: (callback: (result: { success: boolean; outputDir?: string; files?: string[]; error?: string }) => void) => {
    const handler = (_: any, result: any) => callback(result)
    ipcRenderer.on('pipeline:done', handler)
    return () => ipcRenderer.removeListener('pipeline:done', handler)
  },

  onModelsLoaded: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('models:loaded', handler)
    return () => ipcRenderer.removeListener('models:loaded', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
