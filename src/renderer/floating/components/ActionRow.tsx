import type { ActionKind } from '@shared/types'

const ACTIONS: { id: ActionKind; label: string; key: string }[] = [
  { id: 'explain', label: 'Explain', key: '1' },
  { id: 'rewrite', label: 'Rewrite', key: '2' },
  { id: 'summarize', label: 'Summarize', key: '3' },
  { id: 'debug', label: 'Debug', key: '4' },
  { id: 'reply', label: 'Reply', key: '5' },
  { id: 'improve', label: 'Improve', key: '6' }
]

export function ActionRow({ disabled, active, onRun }: { disabled: boolean; active: ActionKind | null; onRun: (action: ActionKind) => void }) {
  return (
    <div className="no-drag flex flex-wrap gap-1.5 px-3" role="toolbar" aria-label="Actions">
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={disabled}
          onClick={() => onRun(action.id)}
          className={`rounded-full px-2.5 py-1 text-[12px] transition disabled:opacity-40 ${active === action.id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-black/5 text-zinc-800 hover:bg-black/10 dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/15'}`}
        >
          {action.label}
          <span className="ml-1 text-[10px] opacity-60">{action.key}</span>
        </button>
      ))}
    </div>
  )
}

export const ACTION_KEYS: Record<string, ActionKind> = Object.fromEntries(ACTIONS.map((action) => [action.key, action.id]))
