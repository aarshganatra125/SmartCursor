import { shell, systemPreferences } from 'electron'
import type { PermissionSnapshot } from '@shared/types'
import type { NativeBridge } from './NativeBridge'

const ACCESSIBILITY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const SCREEN_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export class PermissionManager {
  constructor(private bridge: NativeBridge) {}

  async snapshot(): Promise<PermissionSnapshot> {
    const notes: string[] = []
    let accessibility: PermissionSnapshot['accessibility'] = 'unavailable'
    if (process.platform === 'darwin') {
      if (!this.bridge.installed || !this.bridge.binary) {
        notes.push('Build the macOS helper with npm run build:native. Selection and paste need that helper.')
      } else {
        try {
          const status = await this.bridge.call(['status'], 2000)
          accessibility = status.accessibility === true ? 'granted' : 'denied'
        } catch {
          accessibility = 'denied'
          notes.push('The macOS helper could not be launched. Rebuild it, then allow it in Accessibility.')
        }
        if (accessibility !== 'granted') {
          notes.push(`Allow this helper in System Settings → Privacy & Security → Accessibility: ${this.bridge.binary}`)
        }
        notes.push('Screen capture permission is granted to the app that is running SmartCursor. In development, that app is named Electron.')
      }
    } else if (process.platform === 'win32') {
      accessibility = 'unavailable'
      notes.push('On Windows, selected text is read with a temporary Ctrl+C and the previous clipboard is restored. Pasting back uses Ctrl+V after you approve it.')
    } else {
      notes.push('On Linux, active-window detection uses xdotool and selection uses xclip. Install both for those features.')
    }

    let screenRecording: PermissionSnapshot['screenRecording'] = 'unavailable'
    if (process.platform === 'darwin' || process.platform === 'win32') {
      screenRecording = systemPreferences.getMediaAccessStatus('screen')
      if (screenRecording !== 'granted') {
        notes.push('Screen Recording stays off until you click Capture. A capture is never taken silently.')
      }
    }

    return {
      helperPath: this.bridge.binary,
      helperInstalled: this.bridge.installed,
      accessibility,
      screenRecording,
      notes
    }
  }

  async promptAccessibility(): Promise<PermissionSnapshot> {
    if (process.platform === 'darwin' && this.bridge.installed) {
      await this.bridge.call(['prompt-accessibility'], 2000).catch(() => undefined)
    } else if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy')
    }
    return this.snapshot()
  }

  async open(kind: 'accessibility' | 'screen'): Promise<void> {
    if (process.platform === 'darwin') {
      await shell.openExternal(kind === 'accessibility' ? ACCESSIBILITY_URL : SCREEN_URL)
      return
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy')
    }
  }
}
