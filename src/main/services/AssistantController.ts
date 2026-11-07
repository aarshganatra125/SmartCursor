import { randomUUID } from 'node:crypto'
import { screen } from 'electron'
import type { ApplyRequest, Bootstrap, CaptureResult, HistoryItem, PanelPayload, RunRequest, SettingsData } from '@shared/types'
import { LIMITS, MODEL_PRESETS } from '@shared/types'
import { Ipc } from '@shared/ipc'
import { truncate } from '@shared/text'
import { errorMessage } from '../errors'
import { log } from '../logger'
import { ActionExecutionService, chooseApplyMode } from './ActionExecutionService'
import type { AIService } from './AIService'
import type { ContextManager } from './ContextManager'
import type { ConversationManager } from './ConversationManager'
import type { DesktopWindowManager } from './DesktopWindowManager'
import type { GlobalShortcutManager } from './GlobalShortcutManager'
import type { IntegrationServer } from './IntegrationServer'
import type { OCRService } from './OCRService'
import type { PermissionManager } from './PermissionManager'
import type { ScreenshotService } from './ScreenshotService'
import type { SecureStore } from './SecureStore'
import { type LiveSession, SessionStore } from './SessionStore'
import type { SettingsManager } from './SettingsManager'
import type { ChromeIntegration } from './ChromeIntegration'

export class AssistantController {
  private opening = false
  private runs = new Map<string, AbortController>()

  constructor(
    private windows: DesktopWindowManager,
    private shortcuts: GlobalShortcutManager,
    private context: ContextManager,
    private conversations: ConversationManager,
    private sessions: SessionStore,
    private settings: SettingsManager,
    private secure: SecureStore,
    private permissions: PermissionManager,
    private integrations: IntegrationServer,
    private ai: AIService,
    private actions: ActionExecutionService,
    private screenshots: ScreenshotService,
    private ocr: OCRService,
    private chrome: ChromeIntegration
  ) {}

  async open(): Promise<void> {
    if (this.windows.isFloatingVisible()) {
      this.windows.hideFloating()
      return
    }
    if (this.opening) return
    this.opening = true
    try {
      const point = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(point)
      let snapshot
      try {
        snapshot = await this.context.capture()
      } catch (error) {
        snapshot = {
          id: randomUUID(),
          capturedAt: Date.now(),
          app: { name: 'Unknown', bundleId: '', pid: 0, windowTitle: '', category: 'other' as const },
          selection: '',
          selectionSource: 'none' as const,
          warnings: [errorMessage(error)]
        }
      }
      snapshot.displayId = display.id
      const conversationId = this.conversations.create(snapshot)
      const permissions = await this.permissions.snapshot()
      const integration = this.integrations.snapshot()
      const apply = chooseApplyMode(snapshot, permissions, {
        chrome: integration.chrome.connected,
        vscode: integration.vscode.connected
      })
      const session: LiveSession = {
        snapshot,
        response: '',
        insertText: '',
        directApply: apply.mode,
        applyBlockedReason: apply.reason
      }
      this.sessions.set(conversationId, session)
      const payload: PanelPayload = { conversationId, snapshot, directApply: apply.mode, applyBlockedReason: apply.reason }
      this.windows.showFloating(payload)
      log.info('Assistant opened', { category: snapshot.app.category, source: snapshot.selectionSource, selectionLength: snapshot.selection.length })
    } finally {
      this.opening = false
    }
  }

  hide(): void {
    this.windows.hideFloating()
  }

  openSettings(): void {
    this.windows.showSettings()
  }

  current(): PanelPayload | null {
    return this.windows.currentPanel()
  }

  async bootstrap(): Promise<Bootstrap> {
    const settings = this.settings.get()
    this.windows.setTheme(settings.theme)
    const shortcut = this.shortcuts.status()
    return {
      settings,
      hasApiKey: this.secure.hasApiKey(),
      apiKeyHint: this.secure.hint(),
      shortcutRegistered: shortcut.registered,
      shortcutError: shortcut.error,
      platform: process.platform,
      resolvedTheme: this.windows.resolvedTheme(),
      permissions: await this.permissions.snapshot(),
      integrations: this.integrations.snapshot(),
      storage: 'sqlite',
      models: [...MODEL_PRESETS]
    }
  }

  updateSettings(patch: Partial<SettingsData>): SettingsData {
    const next = this.settings.update(patch)
    this.windows.setTheme(next.theme)
    if (patch.shortcut) this.shortcuts.register()
    this.windows.broadcast(Ipc.integrationsChanged, this.integrations.snapshot())
    return next
  }

  setShortcut(shortcut: string): { registered: boolean; error: string | null; settings: SettingsData } {
    const settings = this.settings.update({ shortcut })
    const status = this.shortcuts.register()
    return { ...status, settings }
  }

  setApiKey(key: string): { hint: string | null } {
    this.secure.write(key)
    return { hint: this.secure.hint() }
  }

  clearApiKey(): void {
    this.secure.clear()
  }

  async run(request: RunRequest, onDelta: (delta: string) => void): Promise<Awaited<ReturnType<AIService['run']>>> {
    const controller = new AbortController()
    const requestId = randomUUID()
    this.runs.set(requestId, controller)
    try {
      return await this.ai.run(request, onDelta, controller.signal)
    } finally {
      this.runs.delete(requestId)
    }
  }

  cancel(): void {
    for (const controller of this.runs.values()) controller.abort()
  }

  async apply(request: ApplyRequest) {
    const session = this.sessions.get(request.conversationId)
    if (!session) return { ok: false, mode: request.mode, error: 'This assistant session is no longer open.' }
    const text = request.mode === 'clipboard' ? request.text : session.insertText || request.text
    return this.actions.apply({ text, mode: request.mode, approved: request.approved, snapshot: session.snapshot })
  }

  async capture(conversationId: string, mode: 'window' | 'screen'): Promise<CaptureResult> {
    const session = this.sessions.get(conversationId)
    if (!session) return { ok: false, text: '', error: 'This assistant session is no longer open.' }
    const shot = await this.screenshots.capture({
      mode,
      windowTitle: session.snapshot.app.windowTitle,
      displayId: session.snapshot.displayId
    })
    const text = truncate((await this.ocr.recognize(shot.file)).trim(), LIMITS.ocr)
    if (!text) return { ok: false, text: '', previewImage: shot.previewImage, error: 'No text was recognized. If the image is black, grant Screen Recording permission.' }
    const snapshot = { ...session.snapshot, ocrText: text, previewImage: shot.previewImage, selection: session.snapshot.selection || text, selectionSource: session.snapshot.selection ? session.snapshot.selectionSource : 'ocr' as const }
    this.sessions.update(conversationId, { snapshot })
    return { ok: true, text, previewImage: shot.previewImage }
  }

  async fetchPage(conversationId: string): Promise<{ ok: boolean; excerpt?: string; url?: string; error?: string }> {
    const session = this.sessions.get(conversationId)
    if (!session) return { ok: false, error: 'This assistant session is no longer open.' }
    if (!this.chrome.connected()) return { ok: false, error: 'The Chrome extension is not connected.' }
    const result = await this.chrome.requestContext(true)
    const excerpt = result?.context?.pageExcerpt?.trim() ?? ''
    if (!result?.ok || !excerpt) return { ok: false, error: result?.error || 'Chrome did not return page text. Some pages, including Google Docs, do not expose their text.' }
    const snapshot = {
      ...session.snapshot,
      chrome: {
        url: result.context?.url || session.snapshot.chrome?.url || '',
        title: result.context?.title || session.snapshot.chrome?.title || '',
        pageExcerpt: truncate(excerpt, LIMITS.page)
      }
    }
    this.sessions.update(conversationId, { snapshot })
    return { ok: true, excerpt: snapshot.chrome?.pageExcerpt, url: snapshot.chrome?.url }
  }

  history(): HistoryItem[] {
    return this.conversations.list()
  }

  deleteHistory(id?: string): void {
    this.conversations.delete(id)
  }

  promptAccessibility() {
    return this.permissions.promptAccessibility()
  }

  openPermission(kind: 'accessibility' | 'screen') {
    return this.permissions.open(kind)
  }

  refreshPermissions() {
    return this.permissions.snapshot()
  }

  rotateToken() {
    return this.integrations.rotateToken()
  }
}
