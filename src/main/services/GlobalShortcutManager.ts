import { globalShortcut } from 'electron'
import type { SettingsManager } from './SettingsManager'

export class GlobalShortcutManager {
  private registered = false
  private error: string | null = null

  constructor(
    private settings: SettingsManager,
    private onTrigger: () => void
  ) {}

  register(): { registered: boolean; error: string | null } {
    globalShortcut.unregisterAll()
    const accelerator = this.settings.get().shortcut
    try {
      this.registered = globalShortcut.register(accelerator, () => this.onTrigger())
      this.error = this.registered ? null : `${accelerator} is already used by another app.`
    } catch (error) {
      this.registered = false
      this.error = error instanceof Error ? error.message : 'Could not register the shortcut.'
    }
    return this.status()
  }

  status(): { registered: boolean; error: string | null } {
    return { registered: this.registered, error: this.error }
  }
}
