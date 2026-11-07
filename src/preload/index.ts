import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Ipc } from '@shared/ipc'
import type { ApplyRequest, Bootstrap, CaptureResult, HistoryItem, IntegrationSnapshot, PanelPayload, PermissionSnapshot, RunRequest, SettingsData } from '@shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  bootstrap: () => ipcRenderer.invoke(Ipc.bootstrap) as Promise<{ ok: boolean; bootstrap?: Bootstrap; error?: string }>,
  hide: () => ipcRenderer.invoke(Ipc.panelHide) as Promise<{ ok: boolean }>,
  current: () => ipcRenderer.invoke(Ipc.panelCurrent) as Promise<PanelPayload | null>,
  openSettings: () => ipcRenderer.invoke(Ipc.settingsOpen) as Promise<{ ok: boolean }>,
  updateSettings: (patch: Partial<SettingsData>) => ipcRenderer.invoke(Ipc.settingsUpdate, patch) as Promise<{ ok: boolean; settings?: SettingsData; error?: string }>,
  setApiKey: (apiKey: string) => ipcRenderer.invoke(Ipc.secretSet, { apiKey }) as Promise<{ ok: boolean; hint?: string | null; error?: string }>,
  clearApiKey: () => ipcRenderer.invoke(Ipc.secretClear) as Promise<{ ok: boolean; error?: string }>,
  copyText: (text: string) => ipcRenderer.invoke(Ipc.copyText, { text }) as Promise<{ ok: boolean; error?: string }>,
  run: (request: RunRequest) => ipcRenderer.invoke(Ipc.aiRun, request),
  cancel: () => ipcRenderer.invoke(Ipc.aiCancel) as Promise<{ ok: boolean }>,
  apply: (request: ApplyRequest) => ipcRenderer.invoke(Ipc.actionApply, request),
  capture: (conversationId: string, mode: 'window' | 'screen') => ipcRenderer.invoke(Ipc.captureOcr, { conversationId, mode }) as Promise<CaptureResult>,
  fetchPage: (conversationId: string) => ipcRenderer.invoke(Ipc.fetchPage, { conversationId }) as Promise<{ ok: boolean; excerpt?: string; url?: string; error?: string }>,
  history: () => ipcRenderer.invoke(Ipc.historyList) as Promise<HistoryItem[]>,
  deleteHistory: (id?: string) => ipcRenderer.invoke(Ipc.historyDelete, { id }) as Promise<{ ok: boolean }>,
  promptAccessibility: () => ipcRenderer.invoke(Ipc.permissionsPrompt) as Promise<PermissionSnapshot>,
  openPermission: (kind: 'accessibility' | 'screen') => ipcRenderer.invoke(Ipc.permissionsOpen, { kind }) as Promise<void>,
  refreshPermissions: () => ipcRenderer.invoke(Ipc.permissionsRefresh) as Promise<PermissionSnapshot>,
  setShortcut: (shortcut: string) => ipcRenderer.invoke(Ipc.shortcutSet, { shortcut }),
  rotateToken: () => ipcRenderer.invoke(Ipc.tokenRotate) as Promise<{ ok: boolean; integrations?: IntegrationSnapshot; error?: string }>,
  onPanel: (callback: (payload: PanelPayload) => void) => subscribe(Ipc.panelOpen, callback),
  onDelta: (callback: (payload: { delta: string }) => void) => subscribe(Ipc.aiDelta, callback),
  onTheme: (callback: (theme: 'light' | 'dark') => void) => subscribe(Ipc.themeChanged, callback),
  onIntegrations: (callback: (snapshot: IntegrationSnapshot) => void) => subscribe(Ipc.integrationsChanged, callback)
}

export type SmartCursorApi = typeof api

contextBridge.exposeInMainWorld('smartcursor', api)
