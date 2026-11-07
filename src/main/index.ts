import { app, globalShortcut, nativeTheme, session } from 'electron'
import { join } from 'node:path'
import { Ipc } from '@shared/ipc'
import { log } from './logger'
import { configureUserData, projectPath } from './paths'
import { registerIpc } from './ipc/register'
import { openDatabase } from './services/Database'
import { SettingsManager } from './services/SettingsManager'
import { SecureStore } from './services/SecureStore'
import { ConversationManager } from './services/ConversationManager'
import { SessionStore } from './services/SessionStore'
import { NativeBridge } from './services/NativeBridge'
import { ActiveApplicationDetector } from './services/ActiveApplicationDetector'
import { SelectionCaptureService } from './services/SelectionCaptureService'
import { PermissionManager } from './services/PermissionManager'
import { IntegrationServer } from './services/IntegrationServer'
import { ChromeIntegration } from './services/ChromeIntegration'
import { VSCodeIntegration } from './services/VSCodeIntegration'
import { ContextManager } from './services/ContextManager'
import { ScreenshotService } from './services/ScreenshotService'
import { OCRService } from './services/OCRService'
import { AIService } from './services/AIService'
import { SportsService } from './services/SportsService'
import { DesktopWindowManager } from './services/DesktopWindowManager'
import { GlobalShortcutManager } from './services/GlobalShortcutManager'
import { ActionExecutionService } from './services/ActionExecutionService'
import { AssistantController } from './services/AssistantController'
import { MouseTriggerService } from './services/MouseTriggerService'

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals')
app.setName('SmartCursor')
configureUserData()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.on('second-instance', () => {
  gateway.settings()
})

const gateway: { open: () => void; openAtPointer: () => void; settings: () => void; hidden: () => void; windows: DesktopWindowManager | null } = {
  open: () => undefined,
  openAtPointer: () => undefined,
  settings: () => undefined,
  hidden: () => undefined,
  windows: null
}

app.whenReady().then(async () => {
  const database = await openDatabase(join(app.getPath('userData'), 'smartcursor.sqlite'))
  const settings = new SettingsManager(database)
  const secure = new SecureStore(join(app.getPath('userData'), 'api-key.bin'))
  const oddsSecure = new SecureStore(join(app.getPath('userData'), 'odds-api-key.bin'))
  const conversations = new ConversationManager(database, settings)
  const sessions = new SessionStore()
  const bridge = new NativeBridge(process.platform === 'darwin' ? projectPath('native', 'macos', 'SmartCursorBridge') : null)
  const detector = new ActiveApplicationDetector(bridge)
  const selection = new SelectionCaptureService(bridge)
  const permissions = new PermissionManager(bridge)
  const integrations = new IntegrationServer(settings, join(app.getPath('userData'), 'bridge.json'))
  const chrome = new ChromeIntegration(integrations)
  const vscode = new VSCodeIntegration(integrations)
  const context = new ContextManager(detector, selection, chrome, vscode, settings)
  const screenshots = new ScreenshotService(settings)
  const ocr = new OCRService(bridge)
  const scores = new SportsService(oddsSecure)
  const ai = new AIService(secure, settings, conversations, sessions, scores)
  const windows = new DesktopWindowManager({
    openAssistant: () => gateway.open(),
    openSettings: () => gateway.settings(),
    onFloatingHidden: () => gateway.hidden()
  })
  gateway.windows = windows
  const shortcuts = new GlobalShortcutManager(settings, () => gateway.open())
  const actions = new ActionExecutionService(bridge, chrome, vscode, windows)
  const mouse = new MouseTriggerService(bridge, settings, () => gateway.openAtPointer())
  const controller = new AssistantController(
    windows, shortcuts, context, conversations, sessions, settings, secure, scores,
    permissions, integrations, ai, actions, screenshots, ocr, chrome, mouse
  )
  gateway.open = () => void controller.open()
  gateway.settings = () => controller.openSettings()
  gateway.hidden = () => controller.cancel()
  // A Shift + right-click elsewhere moves the popup there instead of toggling it off.
  gateway.openAtPointer = () => void controller.open({ toggle: false })
  integrations.onOpenRequest((client, context) => {
    void controller.open({ toggle: false, prefill: context ? { client, context } : undefined })
  })

  windows.setTheme(settings.get().theme)
  windows.create()
  shortcuts.register()
  mouse.sync()
  registerIpc(controller, database)
  integrations.onChange(() => windows.broadcast(Ipc.integrationsChanged, integrations.snapshot()))
  nativeTheme.on('updated', () => windows.broadcast(Ipc.themeChanged, windows.resolvedTheme()))
  await integrations.start()
  if (process.platform === 'darwin' && process.env.SMARTCURSOR_OPEN !== 'settings') app.dock?.hide()
  if (process.env.SMARTCURSOR_OPEN === 'settings') controller.openSettings()
  if (process.env.SMARTCURSOR_OPEN === 'assistant') void controller.open()
  log.info('Shortcut status', shortcuts.status())

  app.on('activate', () => {
    if (process.platform === 'darwin') controller.openSettings()
  })
  app.on('before-quit', () => windows.prepareToQuit())
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    integrations.stop()
    mouse.stop()
    database.close()
    void ocr.dispose()
  })

  const trustedRenderer = (contents: Electron.WebContents) => {
    const url = contents.getURL()
    const devUrl = process.env.ELECTRON_RENDERER_URL
    return url.startsWith('file://') || Boolean(devUrl && url.startsWith(devUrl))
  }
  // Microphone access is requested only after the user clicks the voice button in our own renderer.
  // No external page can navigate into this session, and camera/display capture remains denied.
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return Boolean(contents && trustedRenderer(contents) && (permission === 'media' || permission === 'clipboard-sanitized-write'))
  })
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = permission === 'media' && 'mediaTypes' in details ? details.mediaTypes ?? [] : []
    const audioOnly = mediaTypes.includes('audio') && !mediaTypes.includes('video')
    callback(trustedRenderer(contents) && (permission === 'clipboard-sanitized-write' || (permission === 'media' && audioOnly)))
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (event) => {
      if (event.level === 'error') log.error('Renderer error', { detail: event.message.slice(0, 180) })
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      if (devUrl && url.startsWith(devUrl)) return
      if (url.startsWith('file://')) return
      event.preventDefault()
    })
  })
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'"]
        }
      })
    })
  }
  log.info('SmartCursor ready', { platform: process.platform, storage: database.kind })
}).catch((error: unknown) => {
  log.error('SmartCursor failed to start', { reason: error instanceof Error ? error.message : 'unknown' })
  app.quit()
})

app.on('window-all-closed', () => {
  // Stay available from the menu bar.
})
