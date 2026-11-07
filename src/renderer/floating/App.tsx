import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ActionKind, AiResult, ApplyResult, PanelPayload, WebSource } from '@shared/types'
import { ACTIONS, layoutFor } from './actions'
import { AnswerCard, Composer } from './components/AnswerCard'
import { ContextTray, sourceLabel, type Include, type IncludeKey } from './components/ContextTray'
import { Pill, type CaptureKind } from './components/Pill'

type Status = 'idle' | 'loading' | 'error' | 'ready'

/** Transparent margin around the popup so the CSS shadow is not clipped by the window edge. */
const GUTTER = 14

const freshInclude = (payload: PanelPayload | null): Include => ({
  surrounding: true,
  diagnostics: true,
  page: Boolean(payload?.snapshot.chrome?.pageExcerpt),
  ocr: true
})

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [panel, setPanel] = useState<PanelPayload | null>(null)
  const [response, setResponse] = useState('')
  const [insertText, setInsertText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionKind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [include, setInclude] = useState<Include>(freshInclude(null))
  const [askOpen, setAskOpen] = useState(false)
  const [pointOpen, setPointOpen] = useState(false)
  const [sources, setSources] = useState<WebSource[]>([])
  const [searchQueries, setSearchQueries] = useState<string[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [capturing, setCapturing] = useState(false)
  const lastRun = useRef<{ action: ActionKind; instruction: string } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const loading = status === 'loading'
  const busy = loading || capturing
  const conversationId = panel?.conversationId ?? null
  const displayText = response.replace(/<<<INSERT>>>\s*/g, '').replace(/\s*<<<END>>>/g, '')

  // ── Wiring to the main process ────────────────────────────────────────────
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
        setResponse('')
        setInsertText('')
        setStatus('idle')
        setError(null)
        setAction(null)
        setNotice(null)
        setAskOpen(!payload.snapshot.selection)
        setPointOpen(false)
        setSources([])
        setSearchQueries([])
        setMoreOpen(false)
        setDraft('')
        setCapturing(false)
        setInclude(freshInclude(payload))
        lastRun.current = null
      }),
      api.onDelta(({ delta }) => {
        if (delta) setResponse((current) => current + delta)
      })
    ]
    void api.current().then((payload) => {
      if (payload) setPanel((current) => current ?? payload)
    })
    return () => stops.forEach((stop) => stop())
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // ── The window follows the content size ───────────────────────────────────
  const lastSize = useRef('')
  const report = useCallback((force = false) => {
    const el = rootRef.current
    if (!el || !window.smartcursor) return
    const rect = el.getBoundingClientRect()
    const width = Math.ceil(rect.width) + GUTTER * 2
    const height = Math.ceil(rect.height) + GUTTER * 2
    const key = `${width}x${height}`
    if (!force && key === lastSize.current) return
    lastSize.current = key
    void window.smartcursor.resize(width, height)
  }, [])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => report())
    })
    observer.observe(el)
    // A new session may have the same size as the last one; report anyway so the window is revealed.
    report(true)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [report, conversationId])

  // ── Actions ───────────────────────────────────────────────────────────────
  const layout = useMemo(() => layoutFor(panel?.snapshot.app.category ?? 'other'), [panel?.snapshot.app.category])
  const hasSelection = Boolean(panel?.snapshot.selection)

  const run = useCallback(async (next: ActionKind, instruction = '') => {
    if (!panel || loading) return
    if (next === 'ask' && !instruction.trim()) {
      setAskOpen(true)
      return
    }
    lastRun.current = { action: next, instruction }
    setAction(next)
    setStatus('loading')
    setError(null)
    setNotice(null)
    setResponse('')
    setInsertText('')
    setMoreOpen(false)
    setAskOpen(false)
    setPointOpen(false)
    setDraft('')
    setSources([])
    setSearchQueries([])
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
      setStatus(result.error === 'Cancelled.' ? (response ? 'ready' : 'idle') : 'error')
      setError(result.error === 'Cancelled.' ? null : result.error || 'The request failed.')
      return
    }
    setResponse(result.text)
    setSources(result.sources ?? [])
    setSearchQueries(result.searchQueries ?? [])
    setInsertText(result.insertText || result.text)
    setStatus('ready')
  }, [panel, loading, include, response])

  const capture = useCallback(async (kind: CaptureKind) => {
    if (!panel || busy) return
    setCapturing(true)
    setError(null)
    try {
      if (kind === 'page') {
        const result = await window.smartcursor.fetchPage(panel.conversationId)
        if (!result.ok || !result.excerpt) {
          setError(result.error || 'Page text was not available.')
          setStatus('error')
          return
        }
        setPanel({ ...panel, snapshot: { ...panel.snapshot, chrome: { url: result.url || panel.snapshot.chrome?.url || '', title: panel.snapshot.chrome?.title || '', pageExcerpt: result.excerpt } } })
        setInclude((current) => ({ ...current, page: true }))
        setNotice('Page text added.')
        return
      }
      const result = await window.smartcursor.capture(panel.conversationId, kind)
      if (!result.ok) {
        setError(result.error || 'Capture failed.')
        setStatus('error')
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
      setAskOpen(false)
      setStatus('idle')
    } finally {
      setCapturing(false)
    }
  }, [panel, busy])

  async function apply() {
    if (!panel || !insertText) return
    const result = await window.smartcursor.apply({ conversationId: panel.conversationId, text: insertText, mode: panel.directApply, approved: true }) as ApplyResult
    setNotice(result.ok ? result.detail || 'Done.' : result.error || 'Could not apply that result.')
  }

  async function copy(): Promise<boolean> {
    const text = insertText || displayText
    if (!text) return false
    const result = await window.smartcursor.copyText(text)
    if (!result.ok) setNotice(result.error || 'Copy failed.')
    return result.ok
  }

  /** Ghost cursor: the popup hides and a ghost pointer glides to the control on screen. */
  async function pointAt(query: string) {
    if (!panel || !query.trim()) return
    setDraft('')
    setPointOpen(false)
    await window.smartcursor.ghost(panel.conversationId, query)
  }

  // ── Keyboard: Enter runs the lead action, digits pick the others, typing starts a question ──
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (loading) void window.smartcursor.cancel()
        else if (moreOpen) setMoreOpen(false)
        else if (pointOpen) setPointOpen(false)
        else if (askOpen && !response && hasSelection) setAskOpen(false)
        else void window.smartcursor.hide()
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Enter') {
        event.preventDefault()
        if (hasSelection) void run(layout.primary.id)
        else setAskOpen(true)
        return
      }
      if (hasSelection && /^[1-9]$/.test(event.key)) {
        const order = [layout.primary, ...layout.rest]
        const picked = order[Number(event.key) - 1]
        if (picked) {
          event.preventDefault()
          void run(picked.id)
        }
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setMoreOpen(false)
        setPointOpen(true)
        return
      }
      if (event.key === '/') {
        event.preventDefault()
        setMoreOpen(false)
        setAskOpen(true)
        return
      }
      if (event.key.length === 1 && /\S/.test(event.key) && !loading) {
        event.preventDefault()
        setMoreOpen(false)
        setAskOpen(true)
        setDraft((current) => current + event.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, loading, moreOpen, askOpen, pointOpen, response, hasSelection, layout, run])

  if (!window.smartcursor) {
    return <div className="sc-root" style={{ left: GUTTER, top: GUTTER }}><div className="sc-surface sc-pill px-4 text-[13px]">SmartCursor did not load. Restart the app.</div></div>
  }
  if (!panel) return <div ref={rootRef} className="sc-root" style={{ left: GUTTER, top: GUTTER }} />

  const showAnswer = status !== 'idle' || Boolean(error)
  const showCard = moreOpen || askOpen || pointOpen || showAnswer
  const above = panel.placement === 'above'
  const followUp = status === 'ready' && !moreOpen

  return (
    <div
      ref={rootRef}
      key={panel.conversationId}
      className={`sc-root ${above ? 'is-above' : ''}`}
      style={above ? { left: GUTTER, bottom: GUTTER } : { left: GUTTER, top: GUTTER }}
    >
      <Pill
        primary={layout.primary}
        rest={layout.rest}
        hasSelection={hasSelection}
        isBrowser={panel.snapshot.app.category === 'browser'}
        busy={busy}
        active={action}
        askOpen={askOpen}
        pointOpen={pointOpen}
        moreOpen={moreOpen}
        onRun={(next) => void run(next)}
        onAsk={() => {
          setMoreOpen(false)
          setPointOpen(false)
          setAskOpen((open) => !open || !hasSelection || pointOpen)
        }}
        onPoint={() => {
          setMoreOpen(false)
          setPointOpen((open) => !open)
        }}
        onMore={() => setMoreOpen((open) => !open)}
        onCapture={(kind) => void capture(kind)}
      />
      {showCard && (
        <div className="sc-surface sc-card">
          {pointOpen && !moreOpen ? (
            <Composer
              key="point"
              value={draft}
              autoFocus
              placeholder="Show me where to… (e.g. export as PDF)"
              onChange={setDraft}
              onSubmit={() => void pointAt(draft)}
            />
          ) : moreOpen ? (
            <ContextTray
              snapshot={panel.snapshot}
              include={include}
              busy={busy}
              applyBlockedReason={panel.applyBlockedReason}
              onToggle={(key: IncludeKey) => setInclude((current) => ({ ...current, [key]: !current[key] }))}
              onCapture={(kind) => void capture(kind)}
              onSettings={() => void window.smartcursor.openSettings()}
            />
          ) : (
            <>
              {showAnswer && (
                <AnswerCard
                  action={action ? ACTIONS[action] : null}
                  meta={sourceLabel(panel.snapshot)}
                  text={displayText}
                  error={error}
                  loading={loading}
                  canApply={Boolean(insertText)}
                  applyMode={panel.directApply}
                  appName={panel.snapshot.app.name || 'the app'}
                  notice={notice ?? (panel.directApply === 'clipboard' ? panel.applyBlockedReason ?? null : null)}
                  onCopy={copy}
                  onApply={() => void apply()}
                  onRetry={() => lastRun.current && void run(lastRun.current.action, lastRun.current.instruction)}
                  onStop={() => void window.smartcursor.cancel()}
                  sources={sources}
                  searchQueries={searchQueries}
                  onOpenLink={(url) => void window.smartcursor.openLink(url)}
                />
              )}
              {(askOpen || followUp) && (
                <Composer
                  key="ask"
                  value={draft}
                  autoFocus={askOpen}
                  disabled={loading}
                  placeholder={followUp ? 'Ask a follow-up…' : hasSelection ? 'Ask about this…' : `Ask about ${panel.snapshot.app.name || 'this'}…`}
                  onChange={setDraft}
                  onSubmit={() => void run('ask', draft)}
                />
              )}
              {!showAnswer && !hasSelection && notice && <p className="sc-hint">{notice}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
