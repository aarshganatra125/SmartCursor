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

export function buildSystemPrompt(snapshot: ContextSnapshot, action: ActionKind, search = false): string {
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
    search
      ? 'Use the supplied context for questions about it. For anything else, or anything current (live scores, news, prices, weather, schedules), use Google Search and answer directly with the latest facts. Never ask the user to paste context for a question the web can answer. Do not pretend to see the screen or a webpage that was not included.'
      : 'Use only the context in the conversation. Do not pretend to see the screen, the clipboard, or a webpage that was not included.',
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
  search?: boolean
}): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const history = input.history.slice(-LIMITS.historyMessages).map((message) => ({
    role: message.role,
    content: truncate(message.content, LIMITS.storedMessage)
  }))
  return [
    { role: 'system', content: buildSystemPrompt(input.snapshot, input.action, input.search) },
    ...history,
    {
      role: 'user',
      content: buildUserContent(input.snapshot, input.action, input.instruction, input.include)
    }
  ]
}

/**
 * Prompt for the ghost cursor: find the next control on a screenshot of the user's display.
 * Called again after each click, with the steps done so far, so multi-step paths
 * (Settings → Displays → Brightness, Insert → Table) are guided one click at a time.
 */
export function buildLocatePrompt(goal: string, appName: string, stepsDone: string[] = []): string {
  return [
    'This is a screenshot of the user\'s entire display.',
    appName ? `The app the user started in is ${appName}. It may be a web app inside a browser.` : '',
    `The user's goal: "${truncate(goal.trim(), 300)}"`,
    stepsDone.length
      ? `They have already clicked, in order: ${stepsDone.map((step, index) => `${index + 1}. ${step}`).join('  ')}. The screen now shows the result of the last click.`
      : 'This is the first step.',
    'Find the ONE control (menu, menu item, button, tab, sidebar row, field, slider, link or icon) they should use NEXT to reach the goal.',
    'If the goal needs several clicks, give only the next one; you will be asked again after they click it.',
    'Set "final" to true only if using this control completes the goal (for example the brightness slider itself, or the "Table" menu item).',
    'Set "done" to true, with found false, if the goal is already complete or the control they need is already in use on screen.',
    'Reply with JSON only, no prose:',
    '{"found": true|false, "final": true|false, "done": true|false, "label": "the control\'s text as shown on screen", "hint": "one short sentence on what to do with it", "box_2d": [ymin, xmin, ymax, xmax]}',
    'box_2d is the tight box around that control, normalized to 0-1000 relative to the image. If nothing on screen fits, use found false, omit box_2d, and say in "hint" where it usually is.'
  ].filter(Boolean).join('\n')
}

/** Prompt for "Do it" mode: choose ONE next action from a screenshot. Guardrails are enforced in code. */
export function buildAgentPrompt(goal: string, appName: string, history: string[], notes: string[]): string {
  return [
    'You operate the user\'s Mac one step at a time to complete their goal. This is a screenshot of their entire display.',
    appName ? `The app in front is ${appName} (it may be a web app inside a browser).` : '',
    `Goal: "${truncate(goal.trim(), 300)}"`,
    /\bjira\b/i.test(goal) ? 'For Jira, use open_url with exactly https://smartcursor.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog. Do not open jira.com or a generic Atlassian page.' : '',
    /\b(?:assigned\s+to\s+me|my\s+(?:jira\s+)?tasks?)\b/i.test(goal) ? 'This task is restricted to items assigned to the current user. Before changing any task status, visibly verify the issue assignee is the current user (for example “You” or their signed-in account). Never infer ownership from the project, board, title, or a filter. If the assignee is not visible or is someone else, skip it; if none can be verified, reply with fail.' : '',
    /\bpush\b/i.test(goal) && /\b(?:github|git|branch)\b/i.test(goal) ? 'A GitHub push publishes local code. Before clicking Push, Publish, or Sync Changes, visibly verify the active VS Code branch exactly matches the branch named in the goal. Never use a terminal, switch branches, or push a different branch. If the branch name is not visible or does not match, reply with fail.' : '',
    /\bcommit\b/i.test(goal) && /\bpush\b/i.test(goal) ? 'For a commit-and-push workflow: use only files that are already staged; never click Stage, Unstage, Add, or Stage All. Type the exact commit message supplied in the goal, commit first, confirm the commit completed, then push the verified branch. Only after a successful push may you open Jira. Before changing a Jira issue, visibly verify its exact issue key from the goal.' : '',
    history.length ? `Actions already taken, in order: ${history.map((item, index) => `${index + 1}. ${item}`).join('  ')}` : 'No actions taken yet.',
    notes.length ? `Results from earlier tools:\n${notes.map((note) => truncate(note, 1200)).join('\n')}` : '',
    'Choose exactly ONE next action. Prefer the direct tools over clicking through menus:',
    '- {"action":"find_files","query":"name to search"} finds files and folders in the home folder by name (Spotlight).',
    '- {"action":"open_path","path":"/Users/…/Folder"} opens a folder in Finder or a document in its app. Use exact paths from find_files results.',
    '- {"action":"open_app","name":"App Name"} opens an installed app. {"action":"open_url","url":"https://…"} opens a web page.',
    '- {"action":"click"|"double_click","label":"text on the control","box_2d":[ymin,xmin,ymax,xmax]} clicks a control on screen; box_2d is the tight box normalized to 0-1000.',
    '- {"action":"type","text":"…","submit":false} types into the focused field (click the field first). submit true presses Return after.',
    '- {"action":"key","keys":"cmd+t"} presses a shortcut. {"action":"scroll","direction":"down"|"up"} scrolls under the pointer.',
    '- {"action":"done","summary":"what was achieved"} when the goal is visibly complete. {"action":"fail","summary":"why"} if it cannot be done safely.',
    'Every entry in “Actions already taken” has already succeeded and the screenshot was captured after it. Never repeat an earlier action or click the same named app, sidebar item, button, or tab again just because it remains visible. Do not double-click unless one click is known to be insufficient. After open_app, move on to the next task inside that app.',
    'Rules: never delete, move, rename or overwrite files; never send, submit, buy or pay unless the goal says so; never type passwords or payment details; never use terminals or run commands.',
    'Add "risky": true to any action that sends, deletes, buys, installs or changes settings. Add a short "reason". Reply with JSON only.'
  ].filter(Boolean).join('\n')
}
