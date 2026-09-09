/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    openFile: () => Promise<{ path: string; name: string; size: number } | null>
    checkModels: () => Promise<{
      whisper: boolean
      whisperCached: boolean
      whisperDownloading: boolean
      ffmpeg: string | null
      python: boolean
      pythonVersion: string
      pythonCompatible: boolean
      pythonDeps: boolean
    }>
    loadModels: () => Promise<{ success: boolean; error?: string }>
    clearCache: () => Promise<{ success: boolean }>
    startPipeline: (payload: { inputPath: string; sourceLang: string; targetLang: string }) => void
    checkFfmpeg: () => Promise<string | null>
    downloadFfmpeg: () => Promise<{ success: boolean; error?: string }>
    openFileResult: (filePath: string) => Promise<void>
    openFolder: (folderPath: string) => Promise<void>
    openLink: (url: string) => Promise<void>
    onPipelineLog: (callback: (msg: string) => void) => () => void
    onPipelineProgress: (callback: (pct: number) => void) => () => void
    onModelsProgress: (callback: (pct: number) => void) => () => void
    onPipelineDone: (callback: (result: { success: boolean; outputDir?: string; files?: string[]; error?: string }) => void) => () => void
    onModelsLoaded: (callback: () => void) => () => void
  }
}
