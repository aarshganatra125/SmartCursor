export type AppCategory = 'editor' | 'browser' | 'email' | 'terminal' | 'document' | 'other'

export type ActionKind = 'explain' | 'rewrite' | 'summarize' | 'debug' | 'reply' | 'improve' | 'ask'

export type ContextSource = 'vscode' | 'chrome' | 'accessibility' | 'clipboard' | 'ocr' | 'none'

export type ApplyMode = 'vscode' | 'chrome' | 'paste' | 'clipboard'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface ActiveAppInfo {
  name: string
  bundleId: string
  pid: number
  windowTitle: string
  category: AppCategory
}

export interface DiagnosticItem {
  message: string
  severity: string
  line: number
}

export interface ContextSnapshot {
  id: string
  capturedAt: number
  app: ActiveAppInfo
  selection: string
  selectionSource: ContextSource
  warnings: string[]
  vscode?: {
    fileName: string
    languageId: string
    surrounding: string
    diagnostics: DiagnosticItem[]
  }
  chrome?: {
    url: string
    title: string
    pageExcerpt?: string
  }
  ocrText?: string
  previewImage?: string
  displayId?: number
}

export interface PanelPayload {
  conversationId: string
  snapshot: ContextSnapshot
  directApply: ApplyMode
  applyBlockedReason?: string
  /** Whether the popup grows downward from the cursor or upward from it. */
  placement: 'below' | 'above'
}

export interface PrivacySettings {
  storeHistory: boolean
  allowClipboardFallback: boolean
  allowScreenshotOcr: boolean
}

export interface SettingsData {
  theme: ThemePreference
  model: string
  shortcut: string
  /** macOS: Shift + right-click anywhere opens the popup. */
  mouseTrigger: boolean
  baseUrl: string
  integrations: { chrome: boolean; vscode: boolean }
  privacy: PrivacySettings
}

export interface PermissionSnapshot {
  helperPath: string | null
  helperInstalled: boolean
  accessibility: 'granted' | 'denied' | 'unavailable'
  screenRecording: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'unavailable'
  notes: string[]
}

export interface ClientConnection {
  enabled: boolean
  connected: boolean
  lastSeen: number | null
}

export interface IntegrationSnapshot {
  port: number | null
  token: string | null
  bridgePath: string
  chrome: ClientConnection
  vscode: ClientConnection
}

export interface MouseTriggerStatus {
  supported: boolean
  enabled: boolean
  running: boolean
  error: string | null
}

export interface Bootstrap {
  settings: SettingsData
  mouseTrigger: MouseTriggerStatus
  hasApiKey: boolean
  apiKeyHint: string | null
  hasOddsApiKey: boolean
  oddsApiKeyHint: string | null
  shortcutRegistered: boolean
  shortcutError: string | null
  platform: string
  resolvedTheme: 'light' | 'dark'
  permissions: PermissionSnapshot
  integrations: IntegrationSnapshot
  storage: 'sqlite' | 'json'
  models: string[]
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface HistoryItem {
  id: string
  title: string
  appName: string
  createdAt: number
  preview: string
  messages: HistoryMessage[]
}

export interface WebSource {
  title: string
  url: string
}

export interface AiResult {
  ok: boolean
  requestId: string
  text: string
  insertText: string
  error?: string
  /** Pages Google Search returned when the answer was grounded on the web. */
  sources?: WebSource[]
  /** The searches Gemini ran; Google asks apps to show these as search suggestions. */
  searchQueries?: string[]
}

/** What the ghost-cursor overlay should draw, in coordinates local to the overlay window. */
export type GhostPayload =
  | { kind: 'searching'; query: string; pointer: { x: number; y: number } }
  | { kind: 'found'; query: string; step: number; final: boolean; label: string; hint: string; pointer: { x: number; y: number }; target: { x: number; y: number; width: number; height: number } }
  | { kind: 'message'; text: string; pointer: { x: number; y: number } }

export interface GhostResult {
  ok: boolean
  found?: boolean
  error?: string
}

export interface ApplyResult {
  ok: boolean
  mode: ApplyMode
  error?: string
  detail?: string
}

export interface CaptureResult {
  ok: boolean
  text: string
  previewImage?: string
  error?: string
}

export interface RunRequest {
  conversationId: string
  action: ActionKind
  instruction: string
  includeSurrounding: boolean
  includeDiagnostics: boolean
  includePage: boolean
  includeOcr: boolean
}

export interface ApplyRequest {
  conversationId: string
  text: string
  mode: ApplyMode
  approved: boolean
}

export const MODEL_PRESETS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-pro-preview']

export const LIMITS = {
  selection: 12_000,
  surrounding: 4_000,
  page: 8_000,
  ocr: 8_000,
  instruction: 4_000,
  response: 20_000,
  historyMessages: 8,
  storedMessage: 8_000
}
