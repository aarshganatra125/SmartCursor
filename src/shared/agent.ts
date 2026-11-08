/**
 * "Do it" mode for the ghost cursor: the model picks one action at a time from a screenshot,
 * and every action passes these guardrails before SmartCursor performs it.
 * The guardrails are plain code, not instructions to the model, so a confused or manipulated
 * model cannot talk its way past them.
 */

export type AgentMode = 'show' | 'ask' | 'auto'

export type AgentAction =
  | { kind: 'click'; label: string; box: [number, number, number, number]; double: boolean; risky: boolean; reason: string }
  | { kind: 'type'; text: string; submit: boolean; risky: boolean; reason: string }
  | { kind: 'key'; keys: string; risky: boolean; reason: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; risky: boolean; reason: string }
  | { kind: 'find_files'; query: string; risky: boolean; reason: string }
  | { kind: 'open_path'; path: string; risky: boolean; reason: string }
  | { kind: 'open_app'; name: string; risky: boolean; reason: string }
  | { kind: 'open_url'; url: string; risky: boolean; reason: string }
  | { kind: 'done'; summary: string; risky: false; reason: string }
  | { kind: 'fail'; summary: string; risky: false; reason: string }

export type Verdict = { decision: 'allow' } | { decision: 'confirm'; why: string } | { decision: 'block'; why: string }

export const AGENT_LIMITS = { steps: 12, ms: 120_000, typeChars: 500 }
export const SMARTCURSOR_JIRA_BACKLOG_URL = 'https://smartcursor.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog'

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** Parse the model's JSON. Unknown or malformed actions become null (the run stops). */
export function parseAgentAction(raw: string): AgentAction | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let value: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    value = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const risky = value.risky === true
  const reason = str(value.reason, 200)
  switch (value.action) {
    case 'click':
    case 'double_click': {
      const box = value.box_2d
      if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
      return { kind: 'click', label: str(value.label, 80), box: box as [number, number, number, number], double: value.action === 'double_click', risky, reason }
    }
    case 'type': {
      const text = typeof value.text === 'string' ? value.text.slice(0, AGENT_LIMITS.typeChars + 1) : ''
      return text ? { kind: 'type', text, submit: value.submit === true, risky, reason } : null
    }
    case 'key': {
      const keys = str(value.keys, 40).toLowerCase()
      return keys ? { kind: 'key', keys, risky, reason } : null
    }
    case 'scroll':
      return { kind: 'scroll', direction: value.direction === 'up' ? 'up' : 'down', risky, reason }
    case 'find_files': {
      const query = str(value.query, 120)
      return query ? { kind: 'find_files', query, risky, reason } : null
    }
    case 'open_path': {
      const path = str(value.path, 1000)
      return path ? { kind: 'open_path', path, risky, reason } : null
    }
    case 'open_app': {
      const name = str(value.name, 80)
      return name ? { kind: 'open_app', name, risky, reason } : null
    }
    case 'open_url': {
      const url = str(value.url, 2000)
      return url ? { kind: 'open_url', url, risky, reason } : null
    }
    case 'done':
      return { kind: 'done', summary: str(value.summary, 240), risky: false, reason }
    case 'fail':
      return { kind: 'fail', summary: str(value.summary, 240), risky: false, reason }
    default:
      return null
  }
}

/** Keep named workspace destinations deterministic instead of letting the model guess a public URL. */
export function applyWorkspaceDestination(goal: string, action: AgentAction): AgentAction {
  const mentionsJira = /\bjira\b/i.test(goal)
  const opensJira = action.kind === 'open_url' || (action.kind === 'open_app' && /\bjira\b/i.test(action.name))
  if (mentionsJira && opensJira) {
    return {
      kind: 'open_url',
      url: SMARTCURSOR_JIRA_BACKLOG_URL,
      risky: false,
      reason: 'Open the SmartCursor Jira backlog.'
    }
  }
  return action
}

/** Apps SmartCursor never operates: shells, disk and password tools, and SmartCursor itself. */
const BLOCKED_APPS = [
  'com.apple.terminal', 'com.googlecode.iterm2', 'dev.warp.warp', 'net.kovidgoyal.kitty', 'org.alacritty', 'com.github.wez.wezterm', 'co.zeit.hyper',
  'com.apple.diskutility', 'com.apple.keychainaccess', 'com.apple.scripteditor2', 'com.apple.automator', 'com.apple.activitymonitor',
  'com.github.electron', 'smartcursor'
]
const BLOCKED_APP_NAMES = /^(terminal|iterm2?|warp|kitty|alacritty|wezterm|hyper|disk utility|keychain access|script editor|automator|activity monitor|console|smartcursor|electron)$/i

/** Shortcuts that delete, quit everything, force quit, lock or log out (compared after normalizing). */
const BLOCKED_KEY_LIST = [
  'cmd+backspace', 'cmd+forwarddelete', 'cmd+shift+backspace', 'cmd+alt+shift+backspace', 'cmd+alt+backspace',
  'cmd+alt+escape', 'ctrl+cmd+q', 'cmd+shift+q', 'cmd+alt+shift+q', 'ctrl+cmd+power', 'ctrl+alt+cmd+power'
]

/** Words that mean "this changes or sends something for real". Always asks, even in allow-all mode. */
const RISKY_WORDS = /\b(delete|remove|erase|trash|bin|uninstall|format|wipe|reset|restore|shut\s*down|restart|reboot|log\s*out|sign\s*out|send|submit|post|publish|commit|push|share|pay|payment|buy|purchase|checkout|order|transfer|withdraw|subscribe|install|allow|permission|grant|password|overwrite|replace|discard|don.?t save|empty|unsubscribe|merge|deploy|accept|agree)\b/i
const TASK_STATUS_WORDS = /\b(done|complete(?:d)?|resolve(?:d)?|close(?:d)?|reopen(?:ed)?|in progress|to do)\b/i
const GIT_STAGING_WORDS = /\b(stage|unstage|add all|stage all)\b/i

/** Files that run code when opened; SmartCursor only opens documents and folders. */
const EXECUTABLE = /\.(app|command|sh|bash|zsh|tool|pkg|mpkg|dmg|scpt|scptd|applescript|workflow|terminal|jar|py|rb|pl|js|mjs|exe|bin|run|plugin|kext|prefpane|webloc|inetloc|fileloc)$/i

export interface GuardContext {
  frontBundleId: string
  frontAppName: string
  homeDir: string
  /** The user-approved workflow goal, used only for narrow identity checks. */
  goal?: string
  /** In Allow all mode, only concrete protected actions—not a model's generic risk flag—need confirmation. */
  allowAll?: boolean
  /** The model's own previous actions this run, for loop detection. */
  history: string[]
}

export function normalizeKeys(keys: string): string {
  const parts = keys.toLowerCase().replace(/\s+/g, '').replace(/command/g, 'cmd').replace(/option|opt/g, 'alt').replace(/control/g, 'ctrl').split('+').filter(Boolean)
  const raw = parts.pop() ?? ''
  const key = raw === 'delete' ? 'backspace' : raw === 'esc' ? 'escape' : raw === 'enter' ? 'return' : raw
  const order = ['ctrl', 'alt', 'shift', 'cmd']
  const modifiers = [...new Set(parts)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...modifiers, key].join('+')
}

const BLOCKED_KEYS = new Set(BLOCKED_KEY_LIST.map(normalizeKeys))

/** Expand ~ and reject anything outside the home folder or with tricks like "..". */
export function resolveHomePath(path: string, homeDir: string): string | null {
  const expanded = path.startsWith('~') ? homeDir + path.slice(1) : path
  if (!expanded.startsWith('/') || expanded.includes('/../') || expanded.endsWith('/..') || expanded.includes('\0')) return null
  const home = homeDir.replace(/\/$/, '')
  if (expanded !== home && !expanded.startsWith(`${home}/`)) return null
  if (/\/Library(\/|$)/.test(expanded.slice(home.length))) return null
  return expanded.replace(/\/$/, '') || '/'
}

export function checkAction(action: AgentAction, ctx: GuardContext): Verdict {
  const front = `${ctx.frontBundleId} ${ctx.frontAppName}`.toLowerCase()
  const onScreen = action.kind === 'click' || action.kind === 'type' || action.kind === 'key' || action.kind === 'scroll'
  if (onScreen && (BLOCKED_APPS.some((id) => front.includes(id)) || BLOCKED_APP_NAMES.test(ctx.frontAppName.trim()))) {
    return { decision: 'block', why: `SmartCursor does not operate ${ctx.frontAppName || 'this app'} (terminals, disk, password and system tools are off-limits).` }
  }

  // Doing the same thing three times in a row means it is stuck.
  const signature = describeAction(action)
  if (ctx.history.length >= 2 && ctx.history.slice(-2).every((item) => item === signature)) {
    return { decision: 'block', why: 'It kept repeating the same step, so it stopped.' }
  }

  switch (action.kind) {
    case 'click':
      if (front.includes('com.microsoft.vscode') && GIT_STAGING_WORDS.test(action.label)) {
        return { decision: 'block', why: 'SmartCursor does not stage or unstage files. It can only commit files that are already staged by you.' }
      }
      if (TASK_STATUS_WORDS.test(action.label)) {
        if (isExplicitIssueStatusChange(action, ctx)) return { decision: 'allow' }
        return { decision: 'confirm', why: `This changes a task's status. Confirm that this exact task is assigned to you before clicking “${action.label}”.` }
      }
      if (RISKY_WORDS.test(action.label) && !isExactRequestedMessageSend(action, ctx)) return { decision: 'confirm', why: `Click “${action.label}”?` }
      break
    case 'type': {
      if (action.text.length > AGENT_LIMITS.typeChars) return { decision: 'block', why: 'That is more text than SmartCursor types for you.' }
      const digits = action.text.replace(/[\s-]/g, '')
      if (/\d{13,19}/.test(digits)) return { decision: 'block', why: 'That looks like a card or account number. SmartCursor does not type those.' }
      if (action.submit || RISKY_WORDS.test(action.text)) return { decision: 'confirm', why: `Type “${preview(action.text)}”${action.submit ? ' and press Return' : ''}?` }
      break
    }
    case 'key': {
      const keys = normalizeKeys(action.keys)
      if (BLOCKED_KEYS.has(keys)) {
        return { decision: 'block', why: `The shortcut ${action.keys} can delete files, force quit or log out, so it is blocked.` }
      }
      if ((keys === 'return' || keys === 'cmd+return') && isExactRequestedMessageSend(action, ctx)) break
      if (keys === 'cmd+q' || keys === 'cmd+w' || keys === 'return' || keys === 'cmd+return') {
        return { decision: 'confirm', why: keys === 'cmd+q' ? `Quit ${ctx.frontAppName || 'this app'}?` : keys === 'cmd+w' ? 'Close this window?' : 'Press Return (this may send or submit)?' }
      }
      break
    }
    case 'open_path': {
      const resolved = resolveHomePath(action.path, ctx.homeDir)
      if (!resolved) return { decision: 'block', why: 'SmartCursor only opens folders and documents inside your home folder (not Library).' }
      if (EXECUTABLE.test(resolved)) return { decision: 'block', why: 'That file would run a program when opened, so SmartCursor will not open it.' }
      break
    }
    case 'open_app':
      if (BLOCKED_APP_NAMES.test(action.name.trim()) || /\.(sh|command|py|js)$/i.test(action.name)) {
        return { decision: 'block', why: `SmartCursor does not open ${action.name}.` }
      }
      break
    case 'open_url': {
      let url: URL
      try {
        url = new URL(action.url)
      } catch {
        return { decision: 'block', why: 'That is not a valid web address.' }
      }
      if (url.protocol !== 'https:') return { decision: 'block', why: 'Only https web pages can be opened.' }
      break
    }
    default:
      break
  }
  // The screenshot model can conservatively tag harmless navigation as risky (for example,
  // choosing a conversation before composing a message). In Allow all mode, trust the
  // concrete rules above instead: they still catch Send, Submit, Delete, payment and access
  // controls, but a generic model flag no longer interrupts ordinary navigation.
  if (action.risky && !ctx.allowAll) return { decision: 'confirm', why: action.reason || 'The AI marked this step as risky.' }
  return { decision: 'allow' }
}

/**
 * An Allow all workflow may send exactly the short message and recipient the user named in its
 * original goal. It cannot use this path for a vague “send a message” request, a different
 * recipient, or different text.
 */
function isExactRequestedMessageSend(action: Extract<AgentAction, { kind: 'click' | 'key' }>, ctx: GuardContext): boolean {
  if (!ctx.allowAll) return false
  const goal = ctx.goal ?? ''
  const match = goal.match(/\bsend\s+(?:a\s+)?(?:(?:["“'])(.+?)(?:["”'])|(.+?))\s+(?:message\s+)?to\s+([^.!?]+?)(?:[.!?]|$)/i)
  if (!match) return false
  const message = (match[1] ?? match[2] ?? '').trim().toLowerCase()
  const recipient = match[3].trim().toLowerCase()
  if (!message || !recipient) return false

  const typed = ctx.history.some((item) => item.toLowerCase().includes(`type “${message}”`))
  const selectedRecipient = ctx.history.some((item) => item.toLowerCase().includes(recipient))
  const isSendControl = action.kind === 'click' ? /\bsend\b/i.test(action.label) : /^(?:return|cmd\+return)$/i.test(normalizeKeys(action.keys))
  return typed && selectedRecipient && isSendControl
}

/**
 * A typed request for one named issue is the user's approval for that issue only. Ownership-scoped
 * requests remain guarded because screenshot-only automation cannot prove the assignee safely.
 */
function isExplicitIssueStatusChange(action: Extract<AgentAction, { kind: 'click' }>, ctx: GuardContext): boolean {
  const goal = ctx.goal ?? ''
  if (/\b(?:assigned\s+to\s+me|my\s+(?:jira\s+)?tasks?)\b/i.test(goal)) return false
  const issue = goal.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0]
  if (!issue) return false
  const issuePattern = new RegExp(`\\b${issue.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
  return issuePattern.test(action.label) || ctx.history.some((item) => issuePattern.test(item))
}

export function describeAction(action: AgentAction): string {
  switch (action.kind) {
    case 'click': return `${action.double ? 'double-click' : 'click'} “${action.label}”`
    case 'type': return `type “${preview(action.text)}”${action.submit ? ' + Return' : ''}`
    case 'key': return `press ${normalizeKeys(action.keys)}`
    case 'scroll': return `scroll ${action.direction}`
    case 'find_files': return `find “${action.query}”`
    case 'open_path': return `open ${action.path}`
    case 'open_app': return `open ${action.name}`
    case 'open_url': return `open ${action.url}`
    case 'done': return 'done'
    case 'fail': return 'give up'
  }
}

/**
 * A stable identity for a target that has already been operated. It intentionally combines
 * open_app and click: after opening an app, clicking the same app icon again is redundant.
 * Generic navigation controls are excluded because they can legitimately be used repeatedly.
 */
export function actionTarget(action: AgentAction): string | null {
  const raw = action.kind === 'click' ? action.label : action.kind === 'open_app' ? action.name : ''
  const target = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!target || /^(next|back|previous|continue|more|load more|play|pause)$/i.test(target)) return null
  return target
}

/**
 * Some user goals have an unambiguous final control. Ending immediately after that control avoids
 * an unnecessary screenshot/model round-trip simply to ask whether playback, pause, or opening a
 * one-step app completed successfully.
 */
export function completedGoalSummary(goal: string, action: AgentAction): string | null {
  const requested = goal.toLowerCase()
  const label = action.kind === 'click' ? action.label.trim().toLowerCase() : ''
  if (/\bplay\b/.test(requested) && /^play(?:\s+(?:song|album|playlist))?$/.test(label)) return 'Playback started.'
  if (/\bpause\b/.test(requested) && /^pause(?:\s+(?:song|album|playlist))?$/.test(label)) return 'Playback paused.'
  const oneStepOpen = /^\s*(?:open|launch|start)\s+.+?\s*[.!?]?\s*$/i.test(goal) && !/\b(?:and|then)\b/i.test(goal)
  if (oneStepOpen && action.kind === 'open_app') return `Opened ${action.name}.`
  if (oneStepOpen && action.kind === 'open_url') return 'Opened the requested web page.'
  return null
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
}
