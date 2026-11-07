import type { ReactNode } from 'react'
import type { ActionKind } from '@shared/types'
import type { ActionMeta } from '../actions'
import { AskIcon, Logo, MoreIcon, PageIcon, ScanIcon, ScreenIcon, TargetIcon } from './icons'

export type CaptureKind = 'window' | 'screen' | 'page'

export function Pill({
  primary,
  rest,
  hasSelection,
  isBrowser,
  busy,
  active,
  askOpen,
  pointOpen,
  moreOpen,
  onRun,
  onAsk,
  onPoint,
  onMore,
  onCapture
}: {
  primary: ActionMeta
  rest: ActionMeta[]
  hasSelection: boolean
  isBrowser: boolean
  busy: boolean
  active: ActionKind | null
  askOpen: boolean
  pointOpen: boolean
  moreOpen: boolean
  onRun: (action: ActionKind) => void
  onAsk: () => void
  onPoint: () => void
  onMore: () => void
  onCapture: (kind: CaptureKind) => void
}) {
  return (
    <div className="sc-surface sc-pill" role="toolbar" aria-label="SmartCursor">
      <span className="sc-grip" title="Drag to move" aria-hidden="true" />
      {hasSelection ? (
        <button type="button" className={`sc-chip ${active === primary.id ? 'is-active' : ''}`} disabled={busy} onClick={() => onRun(primary.id)} title={`${primary.name} · Enter`}>
          <Logo busy={busy} />
          <span>{primary.chip}</span>
        </button>
      ) : (
        <button type="button" className={`sc-chip ${askOpen && !pointOpen ? 'is-active' : ''}`} onClick={onAsk} title="Ask anything · /">
          <Logo busy={busy} />
          <span>Ask anything</span>
        </button>
      )}
      <span className="sc-divider" />
      {hasSelection
        ? rest.map((action, index) => (
            <IconButton key={action.id} label={`${action.name} · ${index + 2}`} active={active === action.id} disabled={busy} onClick={() => onRun(action.id)}>
              <action.icon />
            </IconButton>
          ))
        : (
          <>
            <IconButton label="Read this window" disabled={busy} onClick={() => onCapture('window')}><ScanIcon /></IconButton>
            <IconButton label="Read the whole screen" disabled={busy} onClick={() => onCapture('screen')}><ScreenIcon /></IconButton>
            {isBrowser && <IconButton label="Read this page" disabled={busy} onClick={() => onCapture('page')}><PageIcon /></IconButton>}
          </>
        )}
      {hasSelection && <IconButton label="Ask about this · /" active={askOpen && !pointOpen} onClick={onAsk}><AskIcon /></IconButton>}
      <IconButton label="Show me where… · ?" active={pointOpen} disabled={busy} onClick={onPoint}><TargetIcon /></IconButton>
      <span className="sc-divider" />
      <IconButton label="Context and options" active={moreOpen} onClick={onMore}><MoreIcon /></IconButton>
    </div>
  )
}

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`sc-icon ${active ? 'is-active' : ''}`}>
      {children}
    </button>
  )
}
