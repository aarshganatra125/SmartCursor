import type { ReactNode } from 'react'
import type { ActionKind, AppCategory } from '@shared/types'
import { AskIcon, DebugIcon, ExplainIcon, ImproveIcon, ReplyIcon, RewriteIcon, SummarizeIcon } from './components/icons'

export interface ActionMeta {
  id: ActionKind
  /** Label on the primary chip, phrased as a pointing gesture ("Explain this"). */
  chip: string
  /** Short name for tooltips and the answer card header. */
  name: string
  icon: () => ReactNode
}

export const ACTIONS: Record<ActionKind, ActionMeta> = {
  explain: { id: 'explain', chip: 'Explain this', name: 'Explain', icon: ExplainIcon },
  debug: { id: 'debug', chip: 'Debug this', name: 'Debug', icon: DebugIcon },
  rewrite: { id: 'rewrite', chip: 'Rewrite this', name: 'Rewrite', icon: RewriteIcon },
  summarize: { id: 'summarize', chip: 'Summarize', name: 'Summarize', icon: SummarizeIcon },
  reply: { id: 'reply', chip: 'Draft a reply', name: 'Reply', icon: ReplyIcon },
  improve: { id: 'improve', chip: 'Polish this', name: 'Polish', icon: ImproveIcon },
  ask: { id: 'ask', chip: 'Ask anything', name: 'Ask', icon: AskIcon }
}

/** Which action leads, and which follow as icons, depends on the app under the cursor. */
const LAYOUT: Record<AppCategory, { primary: ActionKind; rest: ActionKind[] }> = {
  editor: { primary: 'explain', rest: ['debug', 'rewrite', 'summarize'] },
  browser: { primary: 'explain', rest: ['summarize', 'rewrite', 'reply'] },
  email: { primary: 'reply', rest: ['improve', 'summarize', 'explain'] },
  document: { primary: 'improve', rest: ['rewrite', 'summarize', 'explain'] },
  terminal: { primary: 'explain', rest: ['debug', 'summarize'] },
  other: { primary: 'explain', rest: ['summarize', 'rewrite', 'improve'] }
}

export function layoutFor(category: AppCategory): { primary: ActionMeta; rest: ActionMeta[] } {
  const layout = LAYOUT[category] ?? LAYOUT.other
  return { primary: ACTIONS[layout.primary], rest: layout.rest.map((id) => ACTIONS[id]) }
}
