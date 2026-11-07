import { clipboard } from 'electron'
import type { ApplyMode, ApplyResult, PermissionSnapshot } from '@shared/types'
import type { ContextSnapshot } from '@shared/types'
import { projectPath } from '../paths'
import { runJson } from '../runJson'
import type { ChromeIntegration } from './ChromeIntegration'
import type { DesktopWindowManager } from './DesktopWindowManager'
import type { NativeBridge } from './NativeBridge'
import type { VSCodeIntegration } from './VSCodeIntegration'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function chooseApplyMode(snapshot: ContextSnapshot, permissions: PermissionSnapshot, connections: { chrome: boolean; vscode: boolean }): { mode: ApplyMode; reason?: string } {
  if (snapshot.app.category === 'terminal') {
    return { mode: 'clipboard', reason: 'SmartCursor will not paste into a terminal. Copy the result and review it before using it.' }
  }
  if (snapshot.selectionSource === 'vscode' && connections.vscode) return { mode: 'vscode' }
  if (snapshot.selectionSource === 'chrome' && connections.chrome) return { mode: 'chrome' }
  if (permissions.accessibility === 'granted') return { mode: 'paste' }
  return { mode: 'clipboard', reason: 'Accessibility permission is required to paste into the original app. Copy is available.' }
}

export class ActionExecutionService {
  constructor(
    private bridge: NativeBridge,
    private chrome: ChromeIntegration,
    private vscode: VSCodeIntegration,
    private windows: DesktopWindowManager
  ) {}

  async apply(input: { text: string; mode: ApplyMode; approved: boolean; snapshot: ContextSnapshot }): Promise<ApplyResult> {
    if (input.approved !== true) return { ok: false, mode: input.mode, error: 'Approve the action before SmartCursor changes anything.' }
    const text = input.text.trim()
    if (!text) return { ok: false, mode: input.mode, error: 'There is no result to apply.' }
    if (text.length > 50_000) return { ok: false, mode: input.mode, error: 'That result is too large to apply.' }
    if (input.snapshot.app.category === 'terminal' && input.mode !== 'clipboard') {
      return { ok: false, mode: 'clipboard', error: 'SmartCursor does not type into terminals or run commands.' }
    }
    if (input.mode === 'clipboard') {
      await clipboard.writeText(text)
      return { ok: true, mode: 'clipboard', detail: 'Copied to the clipboard.' }
    }
    if (input.mode === 'vscode') {
      const result = await this.vscode.applyEdit(text)
      if (!result) return { ok: false, mode: 'vscode', error: 'VS Code is not connected. Copy the result instead.' }
      if (!result.ok) return { ok: false, mode: 'vscode', error: result.error || 'VS Code rejected the edit.' }
      return { ok: true, mode: 'vscode', detail: 'Applied in the active VS Code editor.' }
    }
    if (input.mode === 'chrome') {
      const result = await this.chrome.insertText(text)
      if (!result) return { ok: false, mode: 'chrome', error: 'Chrome is not connected. Copy the result instead.' }
      if (!result.ok) return { ok: false, mode: 'chrome', error: result.error || 'Chrome could not find an editable field.' }
      return { ok: true, mode: 'chrome', detail: 'Inserted into the active page.' }
    }
    return this.paste(text, input.snapshot)
  }

  private async paste(text: string, snapshot: ContextSnapshot): Promise<ApplyResult> {
    const previous = await clipboard.readText()
    await clipboard.writeText(text)
    this.windows.hideFloating()
    await sleep(140)
    try {
      if (process.platform === 'darwin') {
        if (snapshot.app.bundleId) await this.bridge.call(['activate', snapshot.app.bundleId], 2000).catch(() => undefined)
        await sleep(180)
        const result = await this.bridge.call(['paste'], 2000)
        if (result.ok === false) {
          return { ok: false, mode: 'paste', error: 'Paste needs Accessibility permission for the SmartCursor helper. The text is on the clipboard.' }
        }
      } else if (process.platform === 'win32') {
        const script = projectPath('native', 'windows', 'paste.ps1')
        if (!script) return { ok: false, mode: 'paste', error: 'Windows paste script is missing. The text is on the clipboard.' }
        await runJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', script], 3000)
      } else {
        await runJson('python3', ['-c', 'import shutil,subprocess,sys\nraise SystemExit(0 if shutil.which("xdotool") else 1)'], 1500)
        await runJson('xdotool', ['key', 'ctrl+v'], 2000)
      }
      await sleep(250)
      await clipboard.writeText(previous)
      return { ok: true, mode: 'paste', detail: `Pasted into ${snapshot.app.name}. The previous clipboard contents were restored.` }
    } catch {
      return { ok: false, mode: 'paste', error: 'Could not paste into the original app. The approved text is still on the clipboard.' }
    }
  }
}
