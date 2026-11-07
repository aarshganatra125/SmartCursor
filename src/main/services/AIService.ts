import { randomUUID } from 'node:crypto'
import type { AiResult, RunRequest } from '@shared/types'
import { buildMessages } from '@shared/prompts'
import { extractInsertable } from '@shared/text'
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
      history: this.conversations.history(request.conversationId)
    })
    const creative = request.action === 'rewrite' || request.action === 'reply' || request.action === 'improve'
    try {
      const text = await streamGemini({
        apiKey,
        model: settings.model,
        baseUrl: settings.baseUrl,
        messages,
        temperature: creative ? 0.4 : undefined,
        signal,
        onDelta
      })
      const insertText = extractInsertable(text)
      this.sessions.update(request.conversationId, { response: text, insertText })
      this.conversations.append(request.conversationId, 'user', request.instruction.trim() || request.action, request.action)
      this.conversations.append(request.conversationId, 'assistant', text, request.action)
      return { ok: true, requestId, text, insertText }
    } catch (error) {
      if (signal.aborted) return { ok: false, requestId, text: '', insertText: '', error: 'Cancelled.' }
      return { ok: false, requestId, text: '', insertText: '', error: explainAiError(error) }
    }
  }
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
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<string> {
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
  const consume = (chunk: string) => {
    const delta = textFromGeminiPayload(chunk)
    if (!delta) return
    text += delta
    input.onDelta(delta)
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
  return text
}

function textFromGeminiPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const candidates = (item as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates ?? []
      return candidates.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? '') ?? [])
    }).join('')
  } catch {
    return ''
  }
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
