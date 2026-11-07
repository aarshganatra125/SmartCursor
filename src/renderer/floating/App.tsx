import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActionKind, AiResult, ApplyResult, PanelPayload } from '@shared/types'
import { ACTION_KEYS, ActionRow } from './components/ActionRow'
import { ContextCard } from './components/ContextCard'
import { Header } from './components/Header'
import { ResponseView } from './components/ResponseView'

type Status = 'idle' | 'loading' | 'error' | 'ready'

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [panel, setPanel] = useState<PanelPayload | null>(null)
  const [instruction, setInstruction] = useState('')
  const [response, setResponse] = useState('')
  const [insertText, setInsertText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionKind | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)
  const [include, setInclude] = useState({ surrounding: true, diagnostics: true, page: false, ocr: true })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loading = status === 'loading'

  useEffect(() => {
    const api = window.smartcursor
    if (!api) return
    void api.bootstrap().then((result) => {
      if (result.bootstrap) setTheme(result.bootstrap.resolvedTheme)
    })
    const stops = [
      api.onTheme(setTheme),
      api.onPanel((payload) => {
        setPanel(payload)
        setInstruction('')
        setResponse('')
        setInsertText('')
        setStatus('idle')
        setError(null)
        setAction(null)
        setConfirm(false)
        setApplyMessage(null)
        setInclude({ surrounding: true, diagnostics: true, page: Boolean(payload.snapshot.chrome?.pageExcerpt), ocr: true })
        requestAnimationFrame(() => inputRef.current?.focus())
      }),
      api.onDelta(({ delta }) => {
        if (delta) setResponse((current) => current + delta)
      })
    ]
    void api.current().then((payload) => {
      if (payload) setPanel(payload)
    })
    return () => stops.forEach((stop) => stop())
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  async function run(next: ActionKind) {
    if (!panel || loading) return
    if (next === 'ask' && !instruction.trim()) {
      setError('Enter an instruction first.')
      setStatus('error')
      return
    }
    setAction(next)
    setStatus('loading')
    setError(null)
    setResponse('')
    setInsertText('')
    setConfirm(false)
    setApplyMessage(null)
    const result = await window.smartcursor.run({
      conversationId: panel.conversationId,
      action: next,
      instruction,
      includeSurrounding: include.surrounding,
      includeDiagnostics: include.diagnostics,
      includePage: include.page && Boolean(panel.snapshot.chrome?.pageExcerpt),
      includeOcr: include.ocr && Boolean(panel.snapshot.ocrText)
    }) as AiResult
    if (!result.ok) {
      setStatus('error')
      setError(result.error || 'The request failed.')
      return
    }
    setResponse(result.text)
    setInsertText(result.insertText || result.text)
    setStatus('ready')
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirm) setConfirm(false)
        else if (loading) void window.smartcursor.cancel()
        else void window.smartcursor.hide()
        return
      }
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT'
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void run('ask')
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      const mapped = ACTION_KEYS[event.key]
      if (mapped) void run(mapped)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function apply() {
    if (!panel || !insertText) return
    const result = await window.smartcursor.apply({
      conversationId: panel.conversationId,
      text: insertText,
      mode: panel.directApply,
      approved: true
    }) as ApplyResult
    setConfirm(false)
    setApplyMessage(result.ok ? result.detail || 'Done.' : result.error || 'Could not apply that result.')
  }

  async function copy() {
    if (!insertText && !response) return
    const result = await window.smartcursor.copyText(insertText || response)
    setApplyMessage(result.ok ? 'Copied.' : result.error || 'Copy failed.')
  }

  if (!window.smartcursor) {
    return <Shell theme={theme}><p className="p-6 text-sm">SmartCursor preload did not load. Restart the app.</p></Shell>
  }

  return (
    <Shell theme={theme}>
      <div className="panel-rise flex h-full flex-col overflow-hidden rounded-[22px] border border-black/10 bg-white/78 text-zinc-900 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/80 dark:text-zinc-50">
        {panel ? (
          <>
            <Header app={panel.snapshot.app} source={panel.snapshot.selectionSource} onSettings={() => void window.smartcursor.openSettings()} onClose={() => void window.smartcursor.hide()} />
            <ContextCard
              snapshot={panel.snapshot}
              includeSurrounding={include.surrounding}
              includeDiagnostics={include.diagnostics}
              includePage={include.page}
              includeOcr={include.ocr}
              busy={loading}
              onToggle={(key) => setInclude((current) => ({ ...current, [key]: !current[key] }))}
              onFetchPage={() => void fetchPage(panel, setPanel, setInclude, setError)}
              onCapture={(mode) => void capture(panel, mode, setPanel, setError, setStatus)}
            />
            <div className="mt-3"><ActionRow disabled={loading} active={action} onRun={(next) => void run(next)} /></div>
            <textarea
              ref={inputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Ask anything about this context"
              className="no-drag mx-3 mt-3 h-16 resize-none rounded-2xl border border-black/10 bg-white/70 px-3 py-2 text-[13px] outline-none placeholder:text-zinc-400 focus:border-amber-500/70 dark:border-white/10 dark:bg-black/20"
            />
            <div className="mt-3 flex min-h-0 flex-1 flex-col pb-1">
              <ResponseView text={response} error={error} loading={loading} />
            </div>
            <footer className="no-drag flex items-center gap-2 px-3 pt-2 pb-3">
              {confirm ? (
                <>
                  <p className="flex-1 text-[11px] leading-4 text-zinc-600 dark:text-zinc-300">Insert the approved text into {panel.snapshot.app.name}? This does not send email or run commands.</p>
                  <button type="button" onClick={() => setConfirm(false)} className="rounded-full px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-black/5 dark:text-zinc-300">Cancel</button>
                  <button type="button" onClick={() => void apply()} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] text-white dark:bg-white dark:text-zinc-900">Confirm</button>
                </>
              ) : (
                <>
                  <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{applyMessage || panel.applyBlockedReason || 'Esc closes · ⌘↵ asks'}</p>
                  <button type="button" onClick={() => void window.smartcursor.hide()} className="rounded-full px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-black/5 dark:text-zinc-300">Dismiss</button>
                  <button type="button" disabled={!response} onClick={() => void copy()} className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] disabled:opacity-40 dark:bg-white/10">Copy</button>
                  {panel.directApply !== 'clipboard' && (
                    <button type="button" disabled={!insertText || loading} onClick={() => setConfirm(true)} className="rounded-full bg-amber-500 px-3 py-1.5 text-[12px] font-medium text-zinc-950 disabled:opacity-40">
                      {panel.directApply === 'vscode' ? 'Apply' : panel.directApply === 'chrome' ? 'Insert' : 'Paste'}
                    </button>
                  )}
                  {status === 'error' && action && <button type="button" onClick={() => void run(action)} className="rounded-full px-3 py-1.5 text-[12px] text-zinc-700 dark:text-zinc-200">Retry</button>}
                </>
              )}
            </footer>
          </>
        ) : (
          <div className="grid h-full place-items-center px-8 text-center text-[13px] text-zinc-500">Press the global shortcut to read the app in front of SmartCursor.</div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { theme: 'light' | 'dark'; children: ReactNode }) {
  return <div className="h-full p-2">{children}</div>
}

async function fetchPage(panel: PanelPayload, setPanel: (value: PanelPayload) => void, setInclude: (value: { surrounding: boolean; diagnostics: boolean; page: boolean; ocr: boolean } | ((current: { surrounding: boolean; diagnostics: boolean; page: boolean; ocr: boolean }) => { surrounding: boolean; diagnostics: boolean; page: boolean; ocr: boolean })) => void, setError: (value: string | null) => void) {
  const result = await window.smartcursor.fetchPage(panel.conversationId)
  if (!result.ok || !result.excerpt) {
    setError(result.error || 'Page text was not available.')
    return
  }
  setPanel({
    ...panel,
    snapshot: {
      ...panel.snapshot,
      chrome: { url: result.url || panel.snapshot.chrome?.url || '', title: panel.snapshot.chrome?.title || '', pageExcerpt: result.excerpt }
    }
  })
  setInclude((current) => ({ ...current, page: true }))
  setError(null)
}

async function capture(panel: PanelPayload, mode: 'window' | 'screen', setPanel: (value: PanelPayload) => void, setError: (value: string | null) => void, setStatus: (value: Status) => void) {
  setStatus('loading')
  const result = await window.smartcursor.capture(panel.conversationId, mode)
  setStatus('idle')
  if (!result.ok) {
    setError(result.error || 'Capture failed.')
    return
  }
  setPanel({
    ...panel,
    snapshot: {
      ...panel.snapshot,
      ocrText: result.text,
      previewImage: result.previewImage,
      selection: panel.snapshot.selection || result.text,
      selectionSource: panel.snapshot.selection ? panel.snapshot.selectionSource : 'ocr'
    }
  })
  setError(null)
}
