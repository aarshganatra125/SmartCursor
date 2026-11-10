import type { ReactNode } from 'react'
import type { ContextSnapshot, ContextSource } from '@shared/types'
import { preview } from '@shared/text'
import { GearIcon, PageIcon, ScanIcon, ScreenIcon } from './icons'
import type { CaptureKind } from './Pill'

export type IncludeKey = 'surrounding' | 'diagnostics' | 'page' | 'ocr'
export type Include = Record<IncludeKey, boolean>

const SOURCE: Record<ContextSource, string> = {
  vscode: 'VS Code',
  chrome: 'Chrome',
  accessibility: 'selection',
  clipboard: 'selection (copied)',
  ocr: 'screen text',
  none: 'nothing selected'
}

export function sourceLabel(snapshot: ContextSnapshot): string {
  if (snapshot.vscode?.fileName) return `${snapshot.vscode.fileName} · VS Code`
  if (snapshot.chrome?.title) return snapshot.chrome.title
  return `${snapshot.app.name || 'Unknown app'} · ${SOURCE[snapshot.selectionSource]}`
}

export function ContextTray({
  snapshot,
  include,
  busy,
  applyBlockedReason,
  onToggle,
  onCapture,
  onSettings
}: {
  snapshot: ContextSnapshot
  include: Include
  busy: boolean
  applyBlockedReason?: string
  onToggle: (key: IncludeKey) => void
  onCapture: (kind: CaptureKind) => void
  onSettings: () => void
}) {
  const chips: ReactNode[] = []
  if (snapshot.vscode?.surrounding) chips.push(<Chip key="s" on={include.surrounding} onClick={() => onToggle('surrounding')}>Nearby code</Chip>)
  if (snapshot.vscode?.diagnostics.length) chips.push(<Chip key="d" on={include.diagnostics} onClick={() => onToggle('diagnostics')}>{snapshot.vscode.diagnostics.length} problem{snapshot.vscode.diagnostics.length === 1 ? '' : 's'}</Chip>)
  if (snapshot.chrome?.pageExcerpt) chips.push(<Chip key="p" on={include.page} onClick={() => onToggle('page')}>Page text</Chip>)
  if (snapshot.ocrText) chips.push(<Chip key="o" on={include.ocr} onClick={() => onToggle('ocr')}>Screen text</Chip>)

  return (
    <section className="sc-card-body">
      <header className="sc-card-head">
        <span className="sc-card-title">Context</span>
        <span className="sc-card-meta">{sourceLabel(snapshot)}</span>
        <button type="button" className="sc-ghost ml-auto" onClick={onSettings} title="Settings"><GearIcon /></button>
      </header>
      <p className="sc-quote">
        {snapshot.selection ? preview(snapshot.selection, 320) : 'Nothing is selected. Read the window or screen, or just ask.'}
      </p>
      {chips.length > 0 && (
        <div className="sc-row">
          <span className="sc-label">Include</span>
          {chips}
        </div>
      )}
      <div className="sc-row">
        <span className="sc-label">Read</span>
        <button type="button" className="sc-ghost" disabled={busy} onClick={() => onCapture('window')}><ScanIcon /> Window</button>
        <button type="button" className="sc-ghost" disabled={busy} onClick={() => onCapture('screen')}><ScreenIcon /> Screen</button>
        {snapshot.app.category === 'browser' && !snapshot.chrome?.pageExcerpt && (
          <button type="button" className="sc-ghost" disabled={busy} onClick={() => onCapture('page')}><PageIcon /> Page</button>
        )}
      </div>
      {(snapshot.warnings.length > 0 || applyBlockedReason) && (
        <ul className="sc-warnings">
          {applyBlockedReason && <li>{applyBlockedReason}</li>}
          {snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`sc-toggle ${on ? 'is-on' : ''}`} onClick={onClick}>
      <span className="sc-toggle-dot" />
      {children}
    </button>
  )
}
