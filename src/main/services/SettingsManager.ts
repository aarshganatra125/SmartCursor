import type { SettingsData } from '@shared/types'
import { isAccelerator, isModelId } from '@shared/text'
import type { AppDatabase } from './Database'

export const DEFAULT_SETTINGS: SettingsData = {
  theme: 'system',
  model: 'gemini-3.5-flash-lite',
  shortcut: 'CommandOrControl+Shift+Space',
  mouseTrigger: true,
  baseUrl: '',
  integrations: { chrome: true, vscode: true },
  privacy: {
    storeHistory: true,
    allowClipboardFallback: true,
    allowScreenshotOcr: true
  }
}

export class SettingsManager {
  constructor(private db: AppDatabase) {}

  get(): SettingsData {
    const raw = this.db.getSetting('settings')
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    try {
      const parsed = JSON.parse(raw) as Partial<SettingsData>
      const settings: SettingsData = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        integrations: { ...DEFAULT_SETTINGS.integrations, ...parsed.integrations },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy }
      }
      // Migrate ids from older builds. Ids listed in MODEL_PRESETS must never be rewritten here.
      if (!settings.model || settings.model.startsWith('gpt-') || settings.model.startsWith('gemini-2.')) {
        settings.model = DEFAULT_SETTINGS.model
        this.db.setSetting('settings', JSON.stringify(settings))
      }
      return settings
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  update(patch: Partial<SettingsData>): SettingsData {
    const current = this.get()
    const next = {
      ...current,
      ...patch,
      integrations: { ...current.integrations, ...patch.integrations },
      privacy: { ...current.privacy, ...patch.privacy }
    }
    this.assertValid(next)
    this.db.setSetting('settings', JSON.stringify(next))
    return next
  }

  getToken(): string | null {
    return this.db.getSetting('bridgeToken')
  }

  setToken(token: string): void {
    this.db.setSetting('bridgeToken', token)
  }

  private assertValid(settings: SettingsData): void {
    if (!isModelId(settings.model)) throw new Error('Enter a model id such as gemini-3.5-flash-lite.')
    if (!isAccelerator(settings.shortcut)) throw new Error('Shortcut must include a modifier and a key, for example CommandOrControl+Shift+Space.')
    if (settings.baseUrl && !/^https:\/\/[^\s]+$/i.test(settings.baseUrl)) {
      throw new Error('API base URL must be an https URL, or be left blank.')
    }
  }
}
