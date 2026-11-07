import { randomUUID } from 'node:crypto'
import { screen } from 'electron'
import type { ApplyRequest, Bootstrap, CaptureResult, GhostResult, HistoryItem, PanelPayload, RunRequest, SettingsData } from '@shared/types'
import { LIMITS, MODEL_PRESETS } from '@shared/types'
import { Ipc } from '@shared/ipc'
import { boxToScreen, choosePlacement } from '@shared/geometry'
import { truncate } from '@shared/text'
import { errorMessage } from '../errors'
import { log } from '../logger'
import { ActionExecutionService, chooseApplyMode } from './ActionExecutionService'
import type { AIService } from './AIService'
import type { ContextManager, ContextPrefill } from './ContextManager'
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
import type { MouseTriggerService } from './MouseTriggerService'

export class AssistantController {
  private opening = false
  private runs = new Map<string, AbortController>()
  private guide: {
    goal: string
    appName: string
    display: Electron.Display
    steps: string[]
    final: boolean
    busy: boolean
    idle: NodeJS.Timeout | null
  } | null = null

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
    private chrome: ChromeIntegration,
    private mouse: MouseTriggerService
  ) {}

  /**
   * Open the popup at the cursor.
   * The global shortcut toggles it; an extension's right-click "Ask SmartCursor" always reopens it
   * with the context that extension already sent.
   */
  async open(options: { prefill?: ContextPrefill; toggle?: boolean } = {}): Promise<void> {
    const toggle = options.toggle ?? true
    if (this.guide) {
      // While a guide waits and clicks cannot be watched, the shortcut means "next step".
      if (toggle && !this.mouse.canWatchClicks()) {
        this.advanceGuide()
        return
      }
      this.endGuide()
    }
    if (toggle && this.windows.isFloatingVisible()) {
      this.windows.hideFloating()
      return
    }
    if (this.opening) return
    this.opening = true
    this.cancel()
    try {
      const point = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(point)
      let snapshot
      try {
        snapshot = await this.context.capture(options.prefill)
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
        applyBlockedReason: apply.reason,
        turns: []
      }
      this.sessions.set(conversationId, session)
      const placement = choosePlacement(point.y, display.workArea)
      const payload: PanelPayload = { conversationId, snapshot, directApply: apply.mode, applyBlockedReason: apply.reason, placement }
      this.windows.showFloating(payload, point, display.workArea)
      log.info('Assistant opened', { category: snapshot.app.category, source: snapshot.selectionSource, selectionLength: snapshot.selection.length })
    } finally {
      this.opening = false
    }
  }

  hide(): void {
    this.windows.hideFloating()
  }

  resize(width: number, height: number): void {
    this.windows.resizeFloating(width, height)
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
    this.mouse.sync()
    return {
      settings,
      mouseTrigger: this.mouse.status(),
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
    if (patch.mouseTrigger !== undefined) this.mouse.sync()
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

  /**
   * Ghost cursor guide: "where do I …?" → capture the display under the pointer, ask Gemini for the
   * next control, and glide a ghost pointer to it. After the user clicks it, look again and point at
   * the next one, until the goal is reached (Settings → Displays → Brightness). It never clicks.
   * Clicks come from the Swift helper; without it, pressing the shortcut moves to the next step.
   */
  async ghost(conversationId: string, query: string): Promise<GhostResult> {
    const session = this.sessions.get(conversationId)
    if (!session) return { ok: false, error: 'This assistant session is no longer open.' }
    const goal = query.trim().slice(0, 300)
    if (!goal) return { ok: false, error: 'Say what you are looking for.' }
    this.endGuide()
    const pointer = screen.getCursorScreenPoint()
    this.guide = {
      goal,
      appName: session.snapshot.app.name,
      display: screen.getDisplayNearestPoint(pointer),
      steps: [],
      final: false,
      busy: false,
      idle: null
    }
    // Start listening now so the helper is up by the time step 1 is shown. Clicks are ignored while busy.
    this.mouse.watchClicks(() => this.advanceGuide())
    // Get the popup out of the way so it is not in the screenshot.
    this.windows.hideFloating()
    await this.guideStep(160)
    return { ok: true }
  }

  /** Move to the next step: called on a click (or the shortcut, when clicks cannot be watched). */
  private advanceGuide(): void {
    const guide = this.guide
    if (!guide || guide.busy) return
    if (guide.final) {
      this.showGhostMessage('Done ✓', 2200)
      this.endGuide(false)
      return
    }
    // Give menus and pages a moment to open before looking again.
    void this.guideStep(650)
  }

  private async guideStep(settleMs: number): Promise<void> {
    const guide = this.guide
    if (!guide) return
    guide.busy = true
    if (guide.idle) clearTimeout(guide.idle)
    this.windows.hideGhost()
    await new Promise((resolve) => setTimeout(resolve, settleMs))
    if (this.guide !== guide) return

    const { display } = guide
    let image: string
    try {
      image = await this.screenshots.captureDisplay({ id: display.id, width: display.size.width, height: display.size.height, scaleFactor: display.scaleFactor })
    } catch (error) {
      this.showGhostMessage(errorMessage(error), 6000)
      this.endGuide(false)
      return
    }
    if (this.guide !== guide) return

    this.windows.showGhost(display.bounds, (origin) => ({ kind: 'searching', query: guide.goal, pointer: this.localPointer(origin) }), 35_000)
    const located = await this.ai.locate({ query: guide.goal, appName: guide.appName, stepsDone: guide.steps, jpegBase64: image })
    if (this.guide !== guide) return
    if (!located.ok) {
      this.showGhostMessage(located.error, 6000)
      this.endGuide(false)
      return
    }
    const { result } = located
    if (!result.found || !result.box) {
      const text = result.done
        ? `Done ✓ ${result.hint}`.trim()
        : result.hint || `Could not find “${guide.goal}” on this screen.`
      this.showGhostMessage(text, 6000)
      log.info('Ghost cursor', { found: false, done: result.done, step: guide.steps.length + 1 })
      this.endGuide(false)
      return
    }

    const step = guide.steps.length + 1
    guide.steps.push(result.label || `step ${step}`)
    guide.final = result.final
    const clicks = this.mouse.canWatchClicks()
    const next = result.final
      ? ''
      : clicks ? 'Click it and I’ll show the next step.' : 'Click it, then press the SmartCursor shortcut for the next step.'
    const target = boxToScreen(result.box, display.bounds)
    this.windows.showGhost(display.bounds, (origin) => ({
      kind: 'found',
      query: guide.goal,
      step,
      final: result.final,
      label: result.label || guide.goal,
      hint: [result.hint, next].filter(Boolean).join(' '),
      pointer: this.localPointer(origin),
      target: { x: target.x - origin.x, y: target.y - origin.y, width: target.width, height: target.height }
    }), 60_000)
    log.info('Ghost cursor', { found: true, step, final: result.final, clicks })

    // Wait for the user's click on this step; stop guiding if nothing happens for a minute.
    guide.idle = setTimeout(() => this.endGuide(), 60_000)
    guide.busy = false
    if (!clicks && result.final) {
      // Nothing to wait for; leave the last pointer up for a while.
      if (guide.idle) clearTimeout(guide.idle)
      guide.idle = setTimeout(() => this.endGuide(), 12_000)
    }
  }

  /** Stop guiding. By default also clears the overlay; pass false to leave a final message showing. */
  private endGuide(hideOverlay = true): void {
    const guide = this.guide
    this.guide = null
    if (guide?.idle) clearTimeout(guide.idle)
    this.mouse.watchClicks(null)
    if (hideOverlay && guide) this.windows.hideGhost()
  }

  private showGhostMessage(text: string, ms: number): void {
    const display = this.guide?.display ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    this.windows.showGhost(display.bounds, (origin) => ({ kind: 'message', text, pointer: this.localPointer(origin) }), ms)
  }

  private localPointer(origin: { x: number; y: number }): { x: number; y: number } {
    const pointer = screen.getCursorScreenPoint()
    return { x: pointer.x - origin.x, y: pointer.y - origin.y }
  }

  history(): HistoryItem[] {
    return this.conversations.list()
  }

  deleteHistory(id?: string): void {
    this.conversations.delete(id)
  }

  async promptAccessibility() {
    const snapshot = await this.permissions.promptAccessibility()
    this.mouse.sync()
    return snapshot
  }

  openPermission(kind: 'accessibility' | 'screen') {
    return this.permissions.open(kind)
  }

  refreshPermissions() {
    this.mouse.sync()
    return this.permissions.snapshot()
  }

  rotateToken() {
    return this.integrations.rotateToken()
  }
}
