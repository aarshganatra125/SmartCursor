import type { ReactNode } from 'react'
import type { ActiveAppInfo, ContextSource } from '@shared/types'

const SOURCE: Record<ContextSource, string> = {
  vscode: 'VS Code extension',
  chrome: 'Chrome extension',
  accessibility: 'Accessibility API',
  clipboard: 'Temporary copy',
  ocr: 'OCR capture',
  none: 'No text detected'
}

export function Header({ app, source, onSettings, onClose }: { app: ActiveAppInfo; source: ContextSource; onSettings: () => void; onClose: () => void }) {
  return (
    <header className="drag flex items-center gap-3 px-4 pt-3.5 pb-2">
      <div className="grid h-8 w-8 place-items-center rounded-xl bg-zinc-900 text-amber-300 dark:bg-white dark:text-zinc-900">
        <Spark />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">SmartCursor</h1>
          <span className="truncate rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300">{app.name || 'Unknown app'} · {app.category}</span>
        </div>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{app.windowTitle || 'No window title'} · {SOURCE[source]}</p>
      </div>
      <div className="no-drag flex gap-1">
        <IconButton label="Settings" onClick={onSettings}><Gear /></IconButton>
        <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </div>
    </header>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">
      {children}
    </button>
  )
}

function Spark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 1.2 9.3 6.2 14.4 8 9.3 9.8 8 14.8 6.7 9.8 1.6 8 6.7 6.2Z" />
    </svg>
  )
}

function Gear() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
