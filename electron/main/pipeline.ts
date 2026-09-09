import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { app } from 'electron'
import { loadWhisperModel, runWhisper, isWhisperReady } from './whisper'
import { translateText } from './translator'
import { getFfmpegPathSafe, runFfmpeg } from './ffmpeg'
import { ensurePythonDeps, checkPythonDeps } from './python_deps'

export interface Segment {
  start: number
  end: number
  text: string
  translated?: string
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(7, '0').replace('.', ',')}`
}

function segmentsToSrt(segments: Segment[], textKey: 'text' | 'translated'): string {
  return segments.map((seg, i) =>
    `${i + 1}\n${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}\n${seg[textKey] || ''}`
  ).join('\n\n') + '\n'
}

function segmentsToPlain(segments: Segment[], textKey: 'text' | 'translated'): string {
  return segments.map(seg => seg[textKey] || '').join('\n')
}

function saveTextFiles(
  segments: Segment[],
  detectedLang: string,
  baseName: string,
  outputDir: string
): void {
  const base = join(outputDir, baseName)

  // Source text — SRT + plain
  writeFileSync(base + '_source.srt', segmentsToSrt(segments, 'text'), 'utf8')
  writeFileSync(base + '_source.txt', segmentsToPlain(segments, 'text'), 'utf8')

  // Translation text — SRT + plain
  writeFileSync(base + '_translation.srt', segmentsToSrt(segments, 'translated'), 'utf8')
  writeFileSync(base + '_translation.txt', segmentsToPlain(segments, 'translated'), 'utf8')
}

const LANG_NAMES: Record<string, string> = {
  en: 'Английский', es: 'Испанский', fr: 'Французский',
  de: 'Немецкий', it: 'Итальянский', pt: 'Португальский',
  nl: 'Нидерландский', pl: 'Польский', ru: 'Русский',
  zh: 'Китайский', ja: 'Японский', ko: 'Корейский',
  ar: 'Арабский', tr: 'Турецкий', hi: 'Хинди',
  vi: 'Вьетнамский', th: 'Тайский', uk: 'Украинский',
  sv: 'Шведский', da: 'Датский', fi: 'Финский',
  cs: 'Чешский', ro: 'Румынский', hu: 'Венгерский',
  el: 'Греческий', he: 'Иврит', id: 'Индонезийский'
}

function getTempDir(clean = false) {
  const dir = join(app.getPath('userData'), 'temp')
  if (clean && existsSync(dir)) {
    const { rmSync } = require('fs')
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getOutputDir() {
  const dir = join(app.getPath('userData'), 'output')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export async function ensureModels(
  onLog: (msg: string) => void,
  onProgress: (pct: number) => void
): Promise<void> {
  onLog('🔍 Проверка зависимостей...')

  await ensurePythonDeps(onLog, onProgress)

  if (!getFfmpegPathSafe()) {
    throw new Error('FFmpeg не найден. Нажмите "Загрузить FFmpeg" перед запуском.')
  }

  if (!isWhisperReady()) {
    await loadWhisperModel(onProgress, onLog)
  }

  onLog('✅ Все модели загружены, запуск пайплайна...')
}

export async function runTranscriptionPipeline(
  inputPath: string,
  sourceLang: string,
  targetLang: string,
  onLog: (msg: string) => void,
  onProgress: (pct: number) => void
): Promise<{ outputDir: string; files: string[] }> {
  const tempDir = getTempDir(true)
  const outputDir = getOutputDir()
  const baseName = inputPath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')

  onLog('[1/3] Извлечение аудио...')
  onProgress(0.05)
  const audioPath = join(tempDir, 'extracted_audio.wav')
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-vn', '-acodec', 'pcm_s16le',
    '-ar', '16000', '-ac', '1',
    audioPath
  ])
  onLog('  ✅ Аудио извлечено')
  onProgress(0.15)

  onLog('[2/3] Распознавание речи (Whisper)...')
  onProgress(0.2)
  const { segments, detectedLang } = await runWhisper(audioPath, sourceLang, onLog)
  const langLabel = LANG_NAMES[detectedLang] || detectedLang.toUpperCase()
  onLog(`  🌐 Определён язык: ${langLabel} (${detectedLang})`)
  onLog(`  📊 Найдено сегментов: ${segments.length}`)
  onProgress(0.4)

  onLog(`[3/3] Перевод на ${LANG_NAMES[targetLang] || targetLang.toUpperCase()}...`)
  onProgress(0.45)

  const translated: Segment[] = []
  const isSameLang = detectedLang === targetLang
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    let translatedText: string
    if (isSameLang) {
      translatedText = seg.text
    } else {
      translatedText = await translateText(seg.text, detectedLang, targetLang)
    }
    translated.push({ ...seg, translated: translatedText })
    if ((i + 1) % 5 === 0 || i === segments.length - 1) {
      onLog(`  📝 Переведено ${i + 1}/${segments.length} сегментов`)
      onProgress(0.45 + ((i + 1) / segments.length) * 0.5)
    }
  }
  onProgress(0.95)

  onLog('  💾 Сохранение текстовых файлов...')
  saveTextFiles(translated, detectedLang, baseName, outputDir)

  const files = [
    baseName + '_source.srt',
    baseName + '_source.txt',
    baseName + '_translation.srt',
    baseName + '_translation.txt',
  ].map(f => join(outputDir, f))

  onLog('✅ Готово! Файлы сохранены:')
  for (const f of files) onLog(`  📄 ${f}`)
  onProgress(1.0)

  return { outputDir, files }
}
