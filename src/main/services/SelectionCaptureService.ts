import type { ContextSource } from '@shared/types'
import { clipSelection } from '@shared/text'
import { projectPath } from '../paths'
import { runJson } from '../runJson'
import type { NativeBridge } from './NativeBridge'

export interface SelectionCapture {
  text: string
  source: ContextSource
  warnings: string[]
}

export class SelectionCaptureService {
  constructor(private bridge: NativeBridge) {}

  async capture(allowClipboardFallback: boolean): Promise<SelectionCapture> {
    try {
      if (process.platform === 'darwin') {
        if (!this.bridge.installed) {
          return { text: '', source: 'none', warnings: ['The macOS helper is missing, so selected text cannot be read.'] }
        }
        const result = await this.bridge.call(['selected-text', allowClipboardFallback ? 'allow-clipboard' : 'ax-only'], 3000)
        return this.fromResult(result, allowClipboardFallback)
      }
      if (!allowClipboardFallback) {
        return { text: '', source: 'none', warnings: ['Clipboard fallback is disabled, and this system has no accessibility text API wired up.'] }
      }
      if (process.platform === 'win32') {
        const script = projectPath('native', 'windows', 'selection.ps1')
        if (!script) return { text: '', source: 'none', warnings: ['Windows selection script is missing.'] }
        const result = await runJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', script], 4000)
        return this.fromResult(result, true)
      }
      const result = await runJson('python3', ['-c', LINUX_SELECTION], 3000)
      return this.fromResult(result, true)
    } catch (error) {
      return {
        text: '',
        source: 'none',
        warnings: [error instanceof Error ? error.message : 'Selected text could not be read.']
      }
    }
  }

  private fromResult(result: Record<string, unknown>, allowClipboard: boolean): SelectionCapture {
    if (result.error === 'accessibility-denied') {
      return {
        text: '',
        source: 'none',
        warnings: ['Accessibility permission is off. Enable the SmartCursor helper in System Settings, then try again.']
      }
    }
    const method = result.method === 'ax' ? 'accessibility' : result.method === 'clipboard' ? 'clipboard' : 'none'
    const text = typeof result.text === 'string' ? clipSelection(result.text) : ''
    const warnings: string[] = []
    if (!text && allowClipboard) warnings.push('No selected text was found in the active application.')
    if (method === 'clipboard') warnings.push('Selection was read with a temporary Copy, and your previous clipboard contents were restored.')
    return { text, source: method, warnings }
  }
}

const LINUX_SELECTION = `
import json, shutil, subprocess, time
if not shutil.which('xdotool') or not shutil.which('xclip'):
    print(json.dumps({'ok': False, 'error': 'Install xdotool and xclip to read selected text.', 'text': '', 'method': 'none'}))
    raise SystemExit
previous = subprocess.run(['xclip', '-selection', 'clipboard', '-o'], text=True, capture_output=True).stdout
sentinel = 'SC_SENTINEL'
subprocess.run(['xclip', '-selection', 'clipboard'], input=sentinel, text=True)
subprocess.run(['xdotool', 'key', 'ctrl+c'])
time.sleep(0.18)
next_value = subprocess.run(['xclip', '-selection', 'clipboard', '-o'], text=True, capture_output=True).stdout
subprocess.run(['xclip', '-selection', 'clipboard'], input=previous, text=True)
if next_value and next_value != sentinel:
    print(json.dumps({'ok': True, 'text': next_value, 'method': 'clipboard'}))
else:
    print(json.dumps({'ok': True, 'text': '', 'method': 'none'}))
`
