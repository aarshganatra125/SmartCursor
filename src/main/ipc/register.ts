import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { ALLOWED_INVOKE, Ipc } from '@shared/ipc'
import type { ApplyRequest, RunRequest, SettingsData } from '@shared/types'
import { errorMessage } from '../errors'
import type { AppDatabase } from '../services/Database'
import type { AssistantController } from '../services/AssistantController'

export function registerIpc(controller: AssistantController, database: AppDatabase): void {
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown) => {
    if (!ALLOWED_INVOKE.has(channel)) throw new Error(`Blocked IPC channel ${channel}`)
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await fn(event, payload)
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    })
  }

  // Fire-and-forget messages from the popup.
  ipcMain.on(Ipc.panelSize, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.width !== 'number' || typeof payload.height !== 'number') return
    if (!Number.isFinite(payload.width) || !Number.isFinite(payload.height)) return
    controller.resize(payload.width, payload.height)
  })
  ipcMain.on(Ipc.panelPin, () => controller.pinPopup())

  handle(Ipc.bootstrap, async () => ({ ok: true, bootstrap: await withStorage(controller, database) }))
  handle(Ipc.panelHide, () => {
    controller.hide()
    return { ok: true }
  })
  handle(Ipc.panelCurrent, () => controller.current())

  handle(Ipc.settingsOpen, () => {
    controller.openSettings()
    return { ok: true }
  })
  handle(Ipc.settingsUpdate, (_event, payload) => ({ ok: true, settings: controller.updateSettings(asSettingsPatch(payload)) }))
  handle(Ipc.secretSet, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.apiKey !== 'string') throw new Error('Missing API key.')
    return { ok: true, ...controller.setApiKey(payload.apiKey) }
  })
  handle(Ipc.secretClear, () => {
    controller.clearApiKey()
    return { ok: true }
  })
  handle(Ipc.oddsSecretSet, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.apiKey !== 'string') throw new Error('Missing Odds API key.')
    return { ok: true, ...controller.setOddsApiKey(payload.apiKey) }
  })
  handle(Ipc.oddsSecretClear, () => {
    controller.clearOddsApiKey()
    return { ok: true }
  })
  handle(Ipc.copyText, async (_event, payload) => {
    if (!isRecord(payload) || typeof payload.text !== 'string' || payload.text.length > 20_000) throw new Error('Nothing to copy.')
    await clipboard.writeText(payload.text)
    return { ok: true }
  })
  handle(Ipc.aiRun, (event, payload) => controller.run(asRun(payload), (delta) => {
    if (!event.sender.isDestroyed()) event.sender.send(Ipc.aiDelta, { delta })
  }))
  handle(Ipc.aiCancel, () => {
    controller.cancel()
    return { ok: true }
  })
  handle(Ipc.voiceTranscribe, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.audio !== 'string' || typeof payload.mimeType !== 'string') throw new Error('Missing audio.')
    if (payload.audio.length === 0 || payload.audio.length > 8_000_000) throw new Error('The recording is too large. Keep voice prompts under 30 seconds.')
    if (!['audio/webm', 'audio/ogg', 'audio/mp4'].includes(payload.mimeType)) throw new Error('Unsupported audio format.')
    return controller.transcribe(payload.audio, payload.mimeType)
  })
  handle(Ipc.actionApply, (_event, payload) => controller.apply(asApply(payload)))
  handle(Ipc.captureOcr, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.conversationId !== 'string') throw new Error('Missing session.')
    const mode = payload.mode === 'screen' ? 'screen' : 'window'
    return controller.capture(payload.conversationId, mode)
  })
  handle(Ipc.fetchPage, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.conversationId !== 'string') throw new Error('Missing session.')
    return controller.fetchPage(payload.conversationId)
  })
  handle(Ipc.ghostRun, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.conversationId !== 'string' || typeof payload.query !== 'string') throw new Error('Missing question.')
    const mode = payload.mode === 'ask' || payload.mode === 'auto' ? payload.mode : 'show'
    return controller.ghost(payload.conversationId, payload.query, mode)
  })
  handle(Ipc.openLink, async (_event, payload) => {
    // Only web links from search results; never file:, javascript: or custom schemes.
    if (!isRecord(payload) || typeof payload.url !== 'string') throw new Error('Missing link.')
    const url = new URL(payload.url)
    if (url.protocol !== 'https:') throw new Error('Only https links can be opened.')
    await shell.openExternal(url.toString())
    return { ok: true }
  })
  handle(Ipc.historyList, () => controller.history())
  handle(Ipc.historyDelete, (_event, payload) => {
    const id = isRecord(payload) && typeof payload.id === 'string' ? payload.id : undefined
    controller.deleteHistory(id)
    return { ok: true }
  })
  handle(Ipc.permissionsPrompt, () => controller.promptAccessibility())
  handle(Ipc.permissionsOpen, (_event, payload) => {
    const kind = isRecord(payload) && payload.kind === 'screen' ? 'screen' : 'accessibility'
    return controller.openPermission(kind)
  })
  handle(Ipc.permissionsRefresh, () => controller.refreshPermissions())
  handle(Ipc.shortcutSet, (_event, payload) => {
    if (!isRecord(payload) || typeof payload.shortcut !== 'string') throw new Error('Missing shortcut.')
    return { ok: true, ...controller.setShortcut(payload.shortcut) }
  })
  handle(Ipc.tokenRotate, () => ({ ok: true, integrations: controller.rotateToken() }))
}

async function withStorage(controller: AssistantController, database: AppDatabase) {
  const bootstrap = await controller.bootstrap()
  return { ...bootstrap, storage: database.kind }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asSettingsPatch(payload: unknown): Partial<SettingsData> {
  if (!isRecord(payload)) throw new Error('Settings payload was empty.')
  const patch: Partial<SettingsData> = {}
  if (payload.theme === 'system' || payload.theme === 'light' || payload.theme === 'dark') patch.theme = payload.theme
  if (typeof payload.model === 'string') patch.model = payload.model
  if (typeof payload.shortcut === 'string') patch.shortcut = payload.shortcut
  if (typeof payload.mouseTrigger === 'boolean') patch.mouseTrigger = payload.mouseTrigger
  if (typeof payload.followPointer === 'boolean') patch.followPointer = payload.followPointer
  if (typeof payload.baseUrl === 'string') patch.baseUrl = payload.baseUrl
  if (isRecord(payload.integrations)) {
    patch.integrations = {
      chrome: payload.integrations.chrome !== false,
      vscode: payload.integrations.vscode !== false
    }
  }
  if (isRecord(payload.privacy)) {
    patch.privacy = {
      storeHistory: payload.privacy.storeHistory !== false,
      allowClipboardFallback: payload.privacy.allowClipboardFallback !== false,
      allowScreenshotOcr: payload.privacy.allowScreenshotOcr !== false
    }
  }
  return patch
}

function asRun(payload: unknown): RunRequest {
  if (!isRecord(payload) || typeof payload.conversationId !== 'string') throw new Error('Missing session.')
  const action = payload.action
  if (action !== 'explain' && action !== 'rewrite' && action !== 'summarize' && action !== 'debug' && action !== 'reply' && action !== 'improve' && action !== 'ask') {
    throw new Error('Unknown action.')
  }
  return {
    conversationId: payload.conversationId,
    action,
    instruction: typeof payload.instruction === 'string' ? payload.instruction.slice(0, 4000) : '',
    includeSurrounding: payload.includeSurrounding !== false,
    includeDiagnostics: payload.includeDiagnostics !== false,
    includePage: payload.includePage === true,
    includeOcr: payload.includeOcr !== false
  }
}

function asApply(payload: unknown): ApplyRequest {
  if (!isRecord(payload) || typeof payload.conversationId !== 'string' || typeof payload.text !== 'string') throw new Error('Missing result.')
  const mode = payload.mode
  if (mode !== 'vscode' && mode !== 'chrome' && mode !== 'paste' && mode !== 'clipboard') throw new Error('Unknown apply mode.')
  return { conversationId: payload.conversationId, text: payload.text, mode, approved: payload.approved === true }
}
