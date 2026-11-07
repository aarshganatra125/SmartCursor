import { randomUUID } from 'node:crypto'
import type { ActionKind, AiResult, RunRequest, WebSource } from '@shared/types'
import { LIMITS } from '@shared/types'
import { buildLocatePrompt, buildMessages } from '@shared/prompts'
import { extractInsertable, parseLocateResult, type LocateResult } from '@shared/text'
import type { ConversationManager } from './ConversationManager'
import type { SecureStore } from './SecureStore'
import type { SessionStore } from './SessionStore'
import type { SettingsManager } from './SettingsManager'

const GEMINI_ROOT = 'https://generativelanguage.googleapis.com/v1beta'

export class AIService {
  constructor(
    private secure: SecureStore,
    private settings: SettingsManager,
    private conversations: ConversationManager,
    private sessions: SessionStore
  ) {}

  async run(request: RunRequest, onDelta: (delta: string) => void, signal: AbortSignal): Promise<AiResult> {
    const requestId = randomUUID()
    const session = this.sessions.get(request.conversationId)
    if (!session) return { ok: false, requestId, text: '', insertText: '', error: 'This assistant session is no longer open.' }
    if (request.action === 'ask' && !request.instruction.trim()) {
      return { ok: false, requestId, text: '', insertText: '', error: 'Enter an instruction first.' }
    }
    const apiKey = this.secure.read()
    if (!apiKey) {
      return { ok: false, requestId, text: '', insertText: '', error: 'Add a Gemini API key in Settings before running an action.' }
    }
    const settings = this.settings.get()
    // Free-form questions may be about the world ("what's the score?"), so let Gemini search.
    const search = request.action === 'ask'
    const messages = buildMessages({
      snapshot: session.snapshot,
      action: request.action,
      instruction: request.instruction,
      include: {
        surrounding: request.includeSurrounding,
        diagnostics: request.includeDiagnostics,
        page: request.includePage,
        ocr: request.includeOcr
      },
      history: session.turns,
      search
    })
    const creative = request.action === 'rewrite' || request.action === 'reply' || request.action === 'improve'
    try {
      const { text, sources, searchQueries } = await streamGemini({
        apiKey,
        model: settings.model,
        baseUrl: settings.baseUrl,
        messages,
        temperature: creative ? 0.4 : undefined,
        search,
        signal,
        onDelta
      })
      const insertText = extractInsertable(text)
      const now = Date.now()
      const turns = [
        ...session.turns,
        { role: 'user' as const, content: buildTurnSummary(request.action, request.instruction), createdAt: now },
        { role: 'assistant' as const, content: text, createdAt: now }
      ].slice(-LIMITS.historyMessages)
      this.sessions.update(request.conversationId, { response: text, insertText, turns })
      this.conversations.append(request.conversationId, 'user', request.instruction.trim() || request.action, request.action)
      this.conversations.append(request.conversationId, 'assistant', text, request.action)
      return { ok: true, requestId, text, insertText, sources, searchQueries }
    } catch (error) {
      if (signal.aborted) return { ok: false, requestId, text: '', insertText: '', error: 'Cancelled.' }
      return { ok: false, requestId, text: '', insertText: '', error: explainAiError(error) }
    }
  }

  /** Ghost cursor: ask Gemini where a control is on a screenshot of one display. */
  async locate(input: { query: string; appName: string; stepsDone: string[]; jpegBase64: string; signal?: AbortSignal }): Promise<{ ok: true; result: LocateResult } | { ok: false; error: string }> {
    const apiKey = this.secure.read()
    if (!apiKey) return { ok: false, error: 'Add a Gemini API key in Settings first.' }
    const settings = this.settings.get()
    const root = (settings.baseUrl || GEMINI_ROOT).replace(/\/$/, '')
    try {
      const response = await fetch(`${root}/models/${encodeURIComponent(settings.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: buildLocatePrompt(input.query, input.appName, input.stepsDone) },
              { inline_data: { mime_type: 'image/jpeg', data: input.jpegBase64 } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 }
        }),
        signal: input.signal ?? AbortSignal.timeout(30_000)
      })
      if (!response.ok) throw new GeminiError(response.status, await geminiErrorMessage(response))
      const body = await response.json() as unknown
      const text = parsePayload(body).text
      const result = parseLocateResult(text)
      if (!result) return { ok: false, error: 'Gemini did not return a usable location. Try rephrasing.' }
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: explainAiError(error) }
    }
  }
}

function buildTurnSummary(action: ActionKind, instruction: string): string {
  return instruction.trim() ? `${action}: ${instruction.trim()}` : action
}

interface GeminiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function streamGemini(input: {
  apiKey: string
  model: string
  baseUrl: string
  messages: GeminiMessage[]
  temperature?: number
  search?: boolean
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<{ text: string; sources: WebSource[]; searchQueries: string[] }> {
  const root = (input.baseUrl || GEMINI_ROOT).replace(/\/$/, '')
  const system = input.messages.find((message) => message.role === 'system')
  const contents = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }))
  const response = await fetch(`${root}/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': input.apiKey
    },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
      contents,
      ...(input.search ? { tools: [{ google_search: {} }] } : {}),
      ...(input.temperature === undefined ? {} : { generationConfig: { temperature: input.temperature } })
    }),
    signal: input.signal
  })
  if (!response.ok) {
    throw new GeminiError(response.status, await geminiErrorMessage(response))
  }
  if (!response.body) throw new GeminiError(response.status, 'Gemini returned an empty response.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const sources = new Map<string, WebSource>()
  const searchQueries = new Set<string>()
  const consume = (chunk: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(chunk)
    } catch {
      return
    }
    const piece = parsePayload(parsed)
    for (const source of piece.sources) sources.set(source.url, source)
    for (const query of piece.searchQueries) searchQueries.add(query)
    if (!piece.text) return
    text += piece.text
    input.onDelta(piece.text)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload && payload !== '[DONE]') consume(payload)
    }
  }
  const rest = buffer.trim()
  if (rest.startsWith('data:')) consume(rest.slice(5).trim())
  else if (rest.startsWith('{') || rest.startsWith('[')) consume(rest)
  if (!text) throw new GeminiError(200, 'Gemini returned no text.')
  return { text, sources: [...sources.values()].slice(0, 6), searchQueries: [...searchQueries].slice(0, 4) }
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  groundingMetadata?: {
    webSearchQueries?: unknown
    groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>
  }
}

/** Pull answer text plus any Google Search grounding out of one response (or one SSE chunk). */
function parsePayload(parsed: unknown): { text: string; sources: WebSource[]; searchQueries: string[] } {
  const items = Array.isArray(parsed) ? parsed : [parsed]
  let text = ''
  const sources: WebSource[] = []
  const searchQueries: string[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const candidates = (item as { candidates?: GeminiCandidate[] }).candidates ?? []
    for (const candidate of candidates) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text && !part.thought) text += part.text
      }
      const grounding = candidate.groundingMetadata
      for (const chunk of grounding?.groundingChunks ?? []) {
        const url = chunk.web?.uri
        if (typeof url === 'string' && /^https:\/\//.test(url)) {
          sources.push({ url, title: typeof chunk.web?.title === 'string' && chunk.web.title ? chunk.web.title : new URL(url).hostname })
        }
      }
      if (Array.isArray(grounding?.webSearchQueries)) {
        for (const query of grounding.webSearchQueries) if (typeof query === 'string' && query.trim()) searchQueries.push(query.trim())
      }
    }
  }
  return { text, sources, searchQueries }
}

class GeminiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function geminiErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } }
    return body.error?.message?.slice(0, 240) || `Gemini request failed (${response.status}).`
  } catch {
    return `Gemini request failed (${response.status}).`
  }
}

function explainAiError(error: unknown): string {
  if (error instanceof GeminiError) {
    if (error.status === 400) return `Gemini rejected the request. ${error.message}`.slice(0, 300)
    if (error.status === 401 || error.status === 403) return 'The Gemini API key was rejected. Check it in Settings.'
    if (error.status === 404) return 'That Gemini model was not found. Choose another model in Settings.'
    if (error.status === 429 || error.status === 503) return 'Gemini is busy right now. Wait a moment and retry.'
    return error.message.slice(0, 300)
  }
  if (error instanceof Error) return error.message.slice(0, 300)
  return 'The model request failed.'
}
