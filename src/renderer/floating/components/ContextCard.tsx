import type { ContextSnapshot } from '@shared/types'
import { preview } from '@shared/text'

export function ContextCard({
  snapshot,
  includeSurrounding,
  includeDiagnostics,
  includePage,
  includeOcr,
  onToggle,
  onFetchPage,
  onCapture,
  busy
}: {
  snapshot: ContextSnapshot
  includeSurrounding: boolean
  includeDiagnostics: boolean
  includePage: boolean
  includeOcr: boolean
  onToggle: (key: 'surrounding' | 'diagnostics' | 'page' | 'ocr') => void
  onFetchPage: () => void
  onCapture: (mode: 'window' | 'screen') => void
  busy: boolean
}) {
  return (
    <section className="mx-3 rounded-2xl border border-black/10 bg-white/55 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Context sent only when you run an action</p>
      </div>
      <p className="max-h-24 overflow-auto whitespace-pre-wrap text-[12.5px] leading-5 text-zinc-800 dark:text-zinc-100">
        {snapshot.selection ? preview(snapshot.selection, 700) : 'Nothing is selected. Choose an action after you capture the window, or ask a question about the current app.'}
      </p>
      {snapshot.vscode && (
        <p className="mt-2 text-[11px] text-zinc-500">{snapshot.vscode.fileName || 'Untitled'} · {snapshot.vscode.languageId || 'text'} · {snapshot.vscode.diagnostics.length} diagnostic{snapshot.vscode.diagnostics.length === 1 ? '' : 's'}</p>
      )}
      {snapshot.chrome?.url && <p className="mt-2 truncate text-[11px] text-zinc-500">{snapshot.chrome.url}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {snapshot.vscode?.surrounding && <Toggle label="Surrounding code" checked={includeSurrounding} onChange={() => onToggle('surrounding')} />}
        {!!snapshot.vscode?.diagnostics.length && <Toggle label="Diagnostics" checked={includeDiagnostics} onChange={() => onToggle('diagnostics')} />}
        {snapshot.app.category === 'browser' && (
          snapshot.chrome?.pageExcerpt
            ? <Toggle label="Page text" checked={includePage} onChange={() => onToggle('page')} />
            : <SmallButton disabled={busy} onClick={onFetchPage}>Fetch page text</SmallButton>
        )}
        {snapshot.ocrText
          ? <Toggle label="OCR text" checked={includeOcr} onChange={() => onToggle('ocr')} />
          : (
            <>
              <SmallButton disabled={busy} onClick={() => onCapture('window')}>Capture window</SmallButton>
              <SmallButton disabled={busy} onClick={() => onCapture('screen')}>Capture screen</SmallButton>
            </>
          )}
      </div>
      {snapshot.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
          {snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="no-drag inline-flex items-center gap-1.5 rounded-full bg-black/5 px-2 py-1 text-[11px] text-zinc-700 dark:bg-white/10 dark:text-zinc-200">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  )
}

function SmallButton({ children, onClick, disabled }: { children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="no-drag rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-zinc-700 hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/10">
      {children}
    </button>
  )
}
