import { execSync } from 'child_process'

/**
 * Cross-platform utilities for VideoAudioToText
 */

export const isWin = process.platform === 'win32'
export const isDarwin = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/**
 * Find the Python executable across platforms.
 * Prioritises Python 3.9+ (required by faster-whisper).
 * On Windows, tries `python`, then `py -3.12`, `py -3.11`, `py -3.10`, `py -3.9`.
 * On macOS/Linux, tries `python3.12`, `python3.11`, `python3.10`, `python3.9`, then `python3`, `python`.
 */
export function getPythonCommand(): string {
  const envPython = process.env.VIDEO_TO_TEXT_PYTHON
  if (envPython) return envPython

  try {
    const { join } = require('path')
    const { app } = require('electron')
    const { existsSync } = require('fs')
    const localPy = join(app.getPath('userData'), 'python311', 'python.exe')
    if (existsSync(localPy)) {
      return localPy
    }
  } catch {}

  const preferredVersions = ['3.12', '3.11', '3.10', '3.9']

  if (isWin) {
    for (const ver of preferredVersions) {
      try {
        execSync(`py -${ver} --version`, { stdio: 'pipe', timeout: 5000 })
        return `py -${ver}`
      } catch {}
    }
    try {
      const out = execSync('python --version 2>&1', { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' })
      const m = out.match(/Python\s+(\d+)\.(\d+)/)
      if (m) {
        const major = parseInt(m[1])
        const minor = parseInt(m[2])
        if (major === 3 && minor >= 9) return 'python'
      }
    } catch {}
    try {
      execSync('python --version', { stdio: 'pipe', timeout: 5000 })
      return 'python'
    } catch {
      try {
        execSync('py --version', { stdio: 'pipe', timeout: 5000 })
        return 'py'
      } catch {
        return 'python'
      }
    }
  }

  for (const ver of preferredVersions) {
    try {
      execSync(`python${ver} --version`, { stdio: 'pipe', timeout: 5000 })
      return `python${ver}`
    } catch {}
  }
  try {
    execSync('python3 --version', { stdio: 'pipe', timeout: 5000 })
    return 'python3'
  } catch {
    try {
      execSync('python --version', { stdio: 'pipe', timeout: 5000 })
      return 'python'
    } catch {
      return 'python3'
    }
  }
}

export const PATH_SEPARATOR = isWin ? ';' : ':'

export function openFolder(folderPath: string): void {
  const { exec } = require('child_process')
  if (isWin) {
    exec(`explorer "${folderPath}"`)
  } else if (isDarwin) {
    exec(`open "${folderPath}"`)
  } else {
    exec(`xdg-open "${folderPath}"`)
  }
}
