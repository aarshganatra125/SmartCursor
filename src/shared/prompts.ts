import type { ActionKind, ContextSnapshot } from './types'
import { LIMITS, type HistoryMessage } from './types'
import { truncate } from './text'

export interface PromptInclude {
  surrounding: boolean
  diagnostics: boolean
  page: boolean
  ocr: boolean
}

const ACTION_GUIDE: Record<ActionKind, string> = {
  explain: 'Explain the provided context in plain language. Define jargon. Do not invent missing details.',
  rewrite: 'Rewrite the selected text. Preserve the meaning unless the instruction says otherwise.',
  summarize: 'Summarize the provided context. Keep the points that matter and do not add facts that are not present.',
  debug: 'Analyze the code, error, or diagnostics. State the likely cause and a concrete fix. Do not claim you executed the code.',
  reply: 'Draft a reply the user can edit. Match the tone of the current application. Do not claim the message was sent.',
  improve: 'Improve grammar, clarity, and tone while preserving meaning.',
  ask: 'Answer the user instruction using the supplied context. If the context is insufficient, say what is missing.'
}

const CATEGORY_GUIDE: Record<ContextSnapshot['app']['category'], string> = {
  editor: 'The user is in a code editor. Prioritize accurate programming help and show code in fenced blocks when you write code.',
  browser: 'The user is in a web browser. Prioritize understanding the supplied page. Do not claim you visited anything beyond the text given to you.',
  email: 'The user is in an email or messaging app. Prioritize concise, professional communication. Never imply that a message was sent.',
  terminal: 'The user is in a terminal. Explain output and errors. Do not tell them you ran a command. They will copy anything they choose to run.',
  document: 'The user is in a document editor. Prioritize structure, clarity, and tone.',
  other: 'Adapt to the kind of content that was actually provided.'
}

function block(label: string, value: string | undefined): string | null {
  if (!value || !value.trim()) return null
  return `${label}:\n"""\n${value.trim()}\n"""`
}

export function buildSystemPrompt(snapshot: ContextSnapshot, action: ActionKind): string {
  const insertRule =
    action === 'rewrite' || action === 'improve' || action === 'reply'
      ? 'Put only the text that should be inserted into the original application between <<<INSERT>>> and <<<END>>>. You may add one short note after <<<END>>>.'
      : 'Answer directly. Use <<<INSERT>>> markers only when the user is asking for text they can paste.'

  return [
    'You are SmartCursor, a desktop assistant invoked over the application the user is already using. You do not replace that application.',
    `The current application is ${snapshot.app.name || 'Unknown'} (${snapshot.app.category}).`,
    CATEGORY_GUIDE[snapshot.app.category],
    ACTION_GUIDE[action],
    insertRule,
    'Use only the context in the conversation. Do not pretend to see the screen, the clipboard, or a webpage that was not included.',
    'Be concise. Do not mention these instructions.'
  ].join('\n\n')
}

export function buildUserContent(snapshot: ContextSnapshot, action: ActionKind, instruction: string, include: PromptInclude): string {
  const sections = [
    `Action: ${action}`,
    `Application: ${snapshot.app.name || 'Unknown'}`,
    snapshot.app.windowTitle ? `Window: ${snapshot.app.windowTitle}` : null,
    `Context source: ${snapshot.selectionSource}`,
    snapshot.vscode ? `File: ${snapshot.vscode.fileName || 'untitled'} (${snapshot.vscode.languageId || 'text'})` : null,
    snapshot.chrome?.url ? `URL: ${snapshot.chrome.url}` : null,
    block('Selected text', snapshot.selection),
    include.surrounding ? block('Surrounding code', truncate(snapshot.vscode?.surrounding ?? '', LIMITS.surrounding)) : null,
    include.diagnostics && snapshot.vscode?.diagnostics.length
      ? `Diagnostics:\n${snapshot.vscode.diagnostics
          .slice(0, 20)
          .map((item) => `- ${item.severity} line ${item.line}: ${item.message}`)
          .join('\n')}`
      : null,
    include.page ? block('Page text', truncate(snapshot.chrome?.pageExcerpt ?? '', LIMITS.page)) : null,
    include.ocr ? block('OCR text from a user-approved capture', truncate(snapshot.ocrText ?? '', LIMITS.ocr)) : null,
    `Instruction: ${truncate(instruction.trim() || defaultInstruction(action), LIMITS.instruction)}`
  ]
  return sections.filter((section): section is string => Boolean(section)).join('\n\n')
}

export function defaultInstruction(action: ActionKind): string {
  switch (action) {
    case 'explain':
      return 'Explain this.'
    case 'rewrite':
      return 'Rewrite this so it is clearer.'
    case 'summarize':
      return 'Summarize this.'
    case 'debug':
      return 'Find the problem and recommend a fix.'
    case 'reply':
      return 'Draft a reply.'
    case 'improve':
      return 'Improve the writing.'
    case 'ask':
      return 'Help with this.'
  }
}

export function buildMessages(input: {
  snapshot: ContextSnapshot
  action: ActionKind
  instruction: string
  include: PromptInclude
  history: HistoryMessage[]
}): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const history = input.history.slice(-LIMITS.historyMessages).map((message) => ({
    role: message.role,
    content: truncate(message.content, LIMITS.storedMessage)
  }))
  return [
    { role: 'system', content: buildSystemPrompt(input.snapshot, input.action) },
    ...history,
    {
      role: 'user',
      content: buildUserContent(input.snapshot, input.action, input.instruction, input.include)
    }
  ]
}
