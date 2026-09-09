import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getPythonCommand } from './platform'

function isPythonPackageInstalled(pkgName: string): boolean {
  const py = getPythonCommand()
  try {
    execSync(`${py} -c "import ${pkgName}"`, {
      stdio: 'pipe',
      timeout: 10000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    return true
  } catch {
    return false
  }
}

function installPythonPackage(
  pkgName: string,
  onLog?: (msg: string) => void,
  timeout: number = 600000
): void {
  const py = getPythonCommand()
  onLog?.(`  📦 Установка ${pkgName}...`)
  try {
    execSync(`${py} -m pip install --no-warn-script-location --no-cache-dir ${pkgName}`, {
      stdio: 'pipe',
      timeout,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PIP_DEFAULT_TIMEOUT: '300' },
    })
    onLog?.(`  ✅ ${pkgName} установлен`)
  } catch (err: any) {
    onLog?.(`  ❌ Ошибка установки ${pkgName}: ${err.message.slice(0, 200)}`)
    throw new Error(`Failed to install ${pkgName}`)
  }
}

export function isPythonAvailable(): boolean {
  const py = getPythonCommand()
  try {
    execSync(`${py} --version`, { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function getPythonVersion(): string | null {
  const py = getPythonCommand()
  try {
    const output = execSync(`${py} --version 2>&1`, {
      stdio: 'pipe', timeout: 5000, encoding: 'utf-8',
    })
    const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/)
    return match ? `${match[1]}.${match[2]}.${match[3]}` : null
  } catch {
    return null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const maxLen = Math.max(pa.length, pb.length)
  for (let i = 0; i < maxLen; i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

/**
 * Download and install Python 3.11 from NuGet package.
 * Only needed on Windows if no compatible Python is found.
 */
async function downloadAndInstallPython311(
  onLog?: (msg: string) => void,
  onProgress?: (pct: number) => void
): Promise<void> {
  const { existsSync, mkdirSync, rmSync, createWriteStream } = require('fs')
  const https = require('https')

  const pyDir = join(app.getPath('userData'), 'python311')
  const pyExe = join(pyDir, 'python.exe')

  if (existsSync(pyExe)) {
    onLog?.('  ✅ Python 3.11 уже установлен в папке приложения')
    return
  }

  if (existsSync(pyDir)) {
    try { rmSync(pyDir, { recursive: true, force: true }) } catch {}
  }
  mkdirSync(pyDir, { recursive: true })

  const zipPath = join(app.getPath('userData'), 'python-3.11.9-nuget.zip')
  const downloadSources = [
    'https://www.nuget.org/api/v2/package/python/3.11.9',
    'https://globalcdn.nuget.org/packages/python.3.11.9.nupkg',
  ]

  onLog?.('  📥 Скачивание Python 3.11.9 (~25 МБ)...')
  onProgress?.(0.02)

  let downloadOk = false
  let lastErr = ''

  for (let srcIdx = 0; srcIdx < downloadSources.length && !downloadOk; srcIdx++) {
    const url = downloadSources[srcIdx]
    for (let attempt = 1; attempt <= 3 && !downloadOk; attempt++) {
      onLog?.(`  🔄 Скачивание (источник ${srcIdx + 1}, попытка ${attempt}/3)...`)
      try {
        await new Promise<void>((resolve, reject) => {
          const download = (dlUrl: string, redirects: number = 0) => {
            if (redirects > 5) { reject(new Error('Too many redirects')); return }
            const req = https.get(dlUrl, (res: any) => {
              if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
                download(res.headers.location, redirects + 1)
                return
              }
              if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`)); return
              }
              const total = parseInt(res.headers['content-length'] || '0')
              let received = 0
              const file = createWriteStream(zipPath)
              res.on('data', (chunk: Buffer) => {
                received += chunk.length
                if (total > 0) onProgress?.(0.02 + (received / total) * 0.08)
              })
              res.pipe(file)
              file.on('finish', () => { file.close(); resolve() })
              file.on('error', (e: any) => { try { rmSync(zipPath, { force: true }) } catch {}; reject(e) })
            })
            req.on('error', (e: any) => { try { rmSync(zipPath, { force: true }) } catch {}; reject(e) })
            req.setTimeout(120000, () => { req.destroy(); try { rmSync(zipPath, { force: true }) } catch {}; reject(new Error('Download timeout')) })
          }
          download(url)
        })
        downloadOk = true
      } catch (err: any) {
        lastErr = err.message
        onLog?.(`  ⚠️ Ошибка: ${lastErr.slice(0, 100)}`)
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
  }

  if (!downloadOk) throw new Error(`Не удалось скачать Python: ${lastErr}`)

  onLog?.('  ✅ Скачивание завершено')
  onProgress?.(0.12)

  onLog?.('  📦 Распаковка Python 3.11.9...')
  try {
    const tempDir = join(app.getPath('userData'), 'python-nuget-temp')
    if (existsSync(tempDir)) { try { rmSync(tempDir, { recursive: true, force: true }) } catch {} }
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`,
      { stdio: 'pipe', timeout: 120000 }
    )
    const toolsDir = join(tempDir, 'tools')
    if (existsSync(toolsDir)) {
      execSync(
        `powershell -Command "Get-ChildItem -Path '${toolsDir}' -Force | Move-Item -Destination '${pyDir}' -Force"`,
        { stdio: 'pipe', timeout: 120000 }
      )
    }
    try { rmSync(tempDir, { recursive: true, force: true }) } catch {}
  } catch (err: any) {
    throw new Error('Failed to unzip Python')
  }

  if (!existsSync(pyExe)) throw new Error('python.exe not found after extraction')

  try { rmSync(zipPath, { force: true }) } catch {}

  try {
    execSync(`"${pyExe}" -m ensurepip --upgrade`, {
      stdio: 'pipe', timeout: 60000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch {}

  onLog?.('  📦 Установка faster-whisper...')
  onProgress?.(0.15)
  try {
    execSync(`"${pyExe}" -m pip install --no-warn-script-location --no-cache-dir faster-whisper`, {
      stdio: 'pipe', timeout: 600000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    onLog?.('  ✅ faster-whisper установлен')
  } catch {
    throw new Error('Failed to install faster-whisper')
  }

  try { execSync(`"${pyExe}" -m pip cache purge`, { stdio: 'pipe', timeout: 30000 }) } catch {}
  onProgress?.(0.2)
  onLog?.('  ✅ Python 3.11.9 + faster-whisper установлены!')
}

function isPythonVersionCompatible(): { ok: boolean; version: string; reason?: string } {
  const version = getPythonVersion()
  if (!version) return { ok: false, version: 'unknown', reason: 'Не удалось определить версию Python' }
  if (compareVersions(version, '3.9') < 0) {
    return { ok: false, version, reason: `Python ${version} слишком старый. Требуется Python 3.9+. Скачайте с python.org` }
  }
  return { ok: true, version }
}

export interface PythonDepsStatus {
  python: boolean
  pythonVersion: string
  pythonCompatible: boolean
  fasterWhisper: boolean
}

export function checkPythonDeps(): PythonDepsStatus {
  const pythonOk = isPythonAvailable()
  if (!pythonOk) {
    return { python: false, pythonVersion: '', pythonCompatible: false, fasterWhisper: false }
  }
  const verInfo = isPythonVersionCompatible()
  return {
    python: true,
    pythonVersion: verInfo.version,
    pythonCompatible: verInfo.ok,
    fasterWhisper: isPythonPackageInstalled('faster_whisper'),
  }
}

export async function ensurePythonDeps(
  onLog?: (msg: string) => void,
  onProgress?: (pct: number) => void
): Promise<void> {
  const status = checkPythonDeps()

  if (!status.python) {
    onLog?.('  📦 Python не найден. Автоустановка Python 3.11...')
    await downloadAndInstallPython311(onLog, onProgress)
    return
  }

  if (!status.pythonCompatible) {
    throw new Error(`Python ${status.pythonVersion} не поддерживается. Требуется Python 3.9+.`)
  }

  if (!status.fasterWhisper) {
    onLog?.('  📦 faster-whisper не установлен. Установка...')
    installPythonPackage('faster-whisper', onLog)
  } else {
    onLog?.('  ✅ faster-whisper уже установлен')
  }
}
