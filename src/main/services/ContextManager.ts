import { randomUUID } from 'node:crypto'
import type { ContextSnapshot } from '@shared/types'
import type { BridgeContext, ClientId } from '@shared/protocol'
import { clipSelection, truncate } from '@shared/text'
import { LIMITS } from '@shared/types'
import type { ActiveApplicationDetector } from './ActiveApplicationDetector'
import type { ChromeIntegration } from './ChromeIntegration'
import type { SelectionCaptureService } from './SelectionCaptureService'
import type { SettingsManager } from './SettingsManager'
import type { VSCodeIntegration } from './VSCodeIntegration'

/** Context an extension already sent with its open request (right-click → Ask SmartCursor). */
export interface ContextPrefill {
  client: ClientId
  context: BridgeContext
}

export class ContextManager {
  constructor(
    private detector: ActiveApplicationDetector,
    private selection: SelectionCaptureService,
    private chrome: ChromeIntegration,
    private vscode: VSCodeIntegration,
    private settings: SettingsManager
  ) {}

  async capture(prefill?: ContextPrefill): Promise<ContextSnapshot> {
    const detected = await this.detector.detect()
    const warnings = [...detected.warnings]
    const settings = this.settings.get()
    let selection = ''
    let selectionSource: ContextSnapshot['selectionSource'] = 'none'
    let vscodeContext: ContextSnapshot['vscode']
    let chromeContext: ContextSnapshot['chrome']

    if (prefill?.client === 'vscode') {
      selection = clipSelection(prefill.context.selection)
      selectionSource = 'vscode'
      vscodeContext = {
        fileName: prefill.context.fileName ?? '',
        workspaceFolder: prefill.context.workspaceFolder,
        languageId: prefill.context.languageId ?? '',
        surrounding: truncate(prefill.context.surrounding ?? '', LIMITS.surrounding),
        diagnostics: prefill.context.diagnostics ?? []
      }
    } else if (prefill?.client === 'chrome') {
      selection = clipSelection(prefill.context.selection)
      selectionSource = 'chrome'
      chromeContext = {
        url: prefill.context.url ?? '',
        title: prefill.context.title ?? '',
        pageExcerpt: prefill.context.pageExcerpt ? truncate(prefill.context.pageExcerpt, LIMITS.page) : undefined
      }
    }

    if (!prefill && detected.app.category === 'editor' && settings.integrations.vscode && this.vscode.connected()) {
      const result = await this.vscode.requestContext()
      const context = result?.context
      if (result?.ok && context) {
        selection = clipSelection(context.selection)
        selectionSource = 'vscode'
        vscodeContext = {
          fileName: context.fileName ?? '',
          workspaceFolder: context.workspaceFolder,
          languageId: context.languageId ?? '',
          surrounding: truncate(context.surrounding ?? '', LIMITS.surrounding),
          diagnostics: context.diagnostics ?? []
        }
      } else {
        warnings.push('The VS Code extension did not answer. Local selection was used instead.')
      }
    }

    if (!prefill && !selection && detected.app.category === 'browser' && settings.integrations.chrome && this.chrome.connected()) {
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

    if (!selection && !prefill) {
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
