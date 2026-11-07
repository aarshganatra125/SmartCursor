import { randomUUID } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopCapturer, systemPreferences } from 'electron'
import type { SettingsManager } from './SettingsManager'

export interface CaptureFile {
  file: string
  previewImage: string
}

export class ScreenshotService {
  constructor(private settings: SettingsManager) {}

  async capture(input: { mode: 'window' | 'screen'; windowTitle: string; displayId?: number }): Promise<CaptureFile> {
    if (!this.settings.get().privacy.allowScreenshotOcr) {
      throw new Error('Screenshot capture is turned off in Privacy settings.')
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const access = systemPreferences.getMediaAccessStatus('screen')
      if (access === 'denied' || access === 'restricted') {
        throw new Error('Screen Recording permission is denied. Enable it for Electron while developing, or for SmartCursor after it is packaged.')
      }
    }
    const sources = await desktopCapturer.getSources({
      types: [input.mode === 'screen' ? 'screen' : 'window'],
      thumbnailSize: { width: 1600, height: 1000 },
      fetchWindowIcons: false
    })
    const source = input.mode === 'screen'
      ? sources.find((item) => item.display_id === String(input.displayId ?? '')) ?? sources[0]
      : sources.find((item) => input.windowTitle && item.name === input.windowTitle)
        ?? sources.find((item) => input.windowTitle && (item.name.includes(input.windowTitle) || input.windowTitle.includes(item.name)))
        ?? sources.find((item) => !/smartcursor|electron/i.test(item.name))
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('The capture came back empty. Grant Screen Recording permission and try again. Nothing was sent anywhere.')
    }
    const file = join(tmpdir(), `smartcursor-${randomUUID()}.png`)
    writeFileSync(file, source.thumbnail.toPNG(), { mode: 0o600 })
    chmodSync(file, 0o600)
    return { file, previewImage: source.thumbnail.resize({ width: 520 }).toDataURL() }
  }
}
