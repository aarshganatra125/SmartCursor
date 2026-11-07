import { randomUUID } from 'node:crypto'
import type { ContextSnapshot } from '@shared/types'
import { clipSelection, truncate } from '@shared/text'
import { LIMITS } from '@shared/types'
import type { ActiveApplicationDetector } from './ActiveApplicationDetector'
import type { ChromeIntegration } from './ChromeIntegration'
import type { SelectionCaptureService } from './SelectionCaptureService'
import type { SettingsManager } from './SettingsManager'
import type { VSCodeIntegration } from './VSCodeIntegration'

export class ContextManager {
  constructor(
    private detector: ActiveApplicationDetector,
    private selection: SelectionCaptureService,
    private chrome: ChromeIntegration,
    private vscode: VSCodeIntegration,
    private settings: SettingsManager
  ) {}

  async capture(): Promise<ContextSnapshot> {
    const detected = await this.detector.detect()
    const warnings = [...detected.warnings]
    const settings = this.settings.get()
    let selection = ''
    let selectionSource: ContextSnapshot['selectionSource'] = 'none'
    let vscodeContext: ContextSnapshot['vscode']
    let chromeContext: ContextSnapshot['chrome']

    if (detected.app.category === 'editor' && settings.integrations.vscode && this.vscode.connected()) {
      const result = await this.vscode.requestContext()
      const context = result?.context
      if (result?.ok && context) {
        selection = clipSelection(context.selection)
        selectionSource = 'vscode'
        vscodeContext = {
          fileName: context.fileName ?? '',
          languageId: context.languageId ?? '',
          surrounding: truncate(context.surrounding ?? '', LIMITS.surrounding),
          diagnostics: context.diagnostics ?? []
        }
      } else {
        warnings.push('The VS Code extension did not answer. Local selection was used instead.')
      }
    }

    if (!selection && detected.app.category === 'browser' && settings.integrations.chrome && this.chrome.connected()) {
      const result = await this.chrome.requestContext(false)
      const context = result?.context
      if (result?.ok && context) {
        selection = clipSelection(context.selection)
        selectionSource = selection ? 'chrome' : selectionSource
        chromeContext = { url: context.url ?? '', title: context.title ?? '' }
        if (!selection) warnings.push('Chrome is connected, but nothing is selected on the page.')
      } else {
        warnings.push('The Chrome extension did not answer. Local selection was used instead.')
      }
    }

    if (!selection) {
      const local = await this.selection.capture(settings.privacy.allowClipboardFallback)
      if (local.text) {
        selection = local.text
        selectionSource = local.source
      }
      warnings.push(...local.warnings.filter((warning) => (local.text ? !warning.startsWith('No selected text') : true)))
    }

    return {
      id: randomUUID(),
      capturedAt: Date.now(),
      app: detected.app,
      selection,
      selectionSource,
      warnings: unique(warnings),
      vscode: vscodeContext,
      chrome: chromeContext
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
