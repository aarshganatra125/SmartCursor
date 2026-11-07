import type { ActiveAppInfo } from '@shared/types'
import { categorizeApp, isOwnApplication } from '@shared/categorize'
import { projectPath } from '../paths'
import { runJson } from '../runJson'
import type { NativeBridge } from './NativeBridge'

export class ActiveApplicationDetector {
  private lastExternal: ActiveAppInfo | null = null

  constructor(private bridge: NativeBridge) {}

  async detect(): Promise<{ app: ActiveAppInfo; warnings: string[] }> {
    const warnings: string[] = []
    try {
      const detected = await this.readFrontmost()
      if (isOwnApplication(detected.name, detected.bundleId)) {
        if (this.lastExternal) {
          warnings.push('SmartCursor was in front, so this uses the previous application.')
          return { app: this.lastExternal, warnings }
        }
        warnings.push('SmartCursor is the frontmost application.')
        return { app: detected, warnings }
      }
      this.lastExternal = detected
      return { app: detected, warnings }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Could not detect the active application.')
      return {
        app: { name: 'Unknown', bundleId: '', pid: 0, windowTitle: '', category: 'other' },
        warnings
      }
    }
  }

  private async readFrontmost(): Promise<ActiveAppInfo> {
    if (process.platform === 'darwin') {
      const result = await this.bridge.call(['frontmost'], 2500)
      return this.toApp(result)
    }
    if (process.platform === 'win32') {
      const script = projectPath('native', 'windows', 'frontmost.ps1')
      if (!script) throw new Error('Windows detection script is missing.')
      const result = await runJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', script], 4000)
      return this.toApp(result)
    }
    const result = await runJson('python3', ['-c', LINUX_FRONTMOST], 2500).catch(() => {
      throw new Error('Active window detection needs xdotool on this system.')
    })
    return this.toApp(result)
  }

  private toApp(result: Record<string, unknown>): ActiveAppInfo {
    if (result.ok === false) throw new Error(typeof result.error === 'string' ? result.error : 'Detection failed.')
    const name = typeof result.name === 'string' ? result.name : 'Unknown'
    const bundleId = typeof result.bundleId === 'string' ? result.bundleId : ''
    const windowTitle = typeof result.title === 'string' ? result.title : ''
    const pid = typeof result.pid === 'number' ? result.pid : 0
    return { name, bundleId, pid, windowTitle, category: categorizeApp(name, bundleId) }
  }
}

const LINUX_FRONTMOST = `
import json, shutil, subprocess
if not shutil.which('xdotool'):
    print(json.dumps({'ok': False, 'error': 'Install xdotool to detect the active window.'}))
    raise SystemExit
wid = subprocess.check_output(['xdotool', 'getactivewindow'], text=True).strip()
title = subprocess.check_output(['xdotool', 'getwindowname', wid], text=True).strip()
pid = subprocess.check_output(['xdotool', 'getwindowpid', wid], text=True).strip()
name = subprocess.check_output(['ps', '-p', pid, '-o', 'comm='], text=True).strip()
print(json.dumps({'ok': True, 'name': name, 'bundleId': '', 'pid': int(pid), 'title': title}))
`
