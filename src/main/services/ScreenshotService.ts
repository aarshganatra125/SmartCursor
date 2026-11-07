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

  /**
   * Capture one whole display as JPEG, for the ghost cursor. Kept in memory only, never written to disk.
   * Uses the display's real pixels (Retina is 2×) so small menu text stays readable, with the long side
   * capped at 1920px: about six 768px tiles, ~1,500 image tokens.
   */
  async captureDisplay(display: { id: number; width: number; height: number; scaleFactor: number }): Promise<string> {
    this.assertAllowed()
    const scale = Math.min(display.scaleFactor, 1920 / Math.max(display.width, display.height))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.width * scale), height: Math.round(display.height * scale) },
      fetchWindowIcons: false
    })
    const source = sources.find((item) => item.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined)
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('The screen capture came back empty. Allow Screen Recording for SmartCursor (Electron while developing), then try again.')
    }
    return source.thumbnail.toJPEG(82).toString('base64')
  }

  private assertAllowed(): void {
    if (!this.settings.get().privacy.allowScreenshotOcr) {
      throw new Error('Screen capture is turned off in Settings → Privacy.')
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const access = systemPreferences.getMediaAccessStatus('screen')
      if (access === 'denied' || access === 'restricted') {
        throw new Error('Screen Recording permission is denied. Enable it for Electron while developing, or for SmartCursor after it is packaged.')
      }
    }
  }

  async capture(input: { mode: 'window' | 'screen'; windowTitle: string; displayId?: number }): Promise<CaptureFile> {
    this.assertAllowed()
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
