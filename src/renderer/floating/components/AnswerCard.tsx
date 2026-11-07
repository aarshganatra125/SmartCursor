import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ApplyMode, WebSource } from '@shared/types'
import type { ActionMeta } from '../actions'
import { CheckIcon, CopyIcon, GlobeIcon, InsertIcon, RetryIcon, SendIcon, StopIcon } from './icons'

const APPLY_LABEL: Record<Exclude<ApplyMode, 'clipboard'>, string> = {
  vscode: 'Apply',
  chrome: 'Insert',
  paste: 'Paste'
}

export function AnswerCard({
  action,
  meta,
  text,
  error,
  loading,
  canApply,
  applyMode,
  appName,
  notice,
  onCopy,
  onApply,
  onRetry,
  onStop,
  sources,
  searchQueries,
  onOpenLink
}: {
  action: ActionMeta | null
  meta: string
  text: string
  error: string | null
  loading: boolean
  canApply: boolean
  applyMode: ApplyMode
  appName: string
  notice: string | null
  onCopy: () => Promise<boolean>
  onApply: () => void
  onRetry: () => void
  onStop: () => void
  sources: WebSource[]
  searchQueries: string[]
  onOpenLink: (url: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setConfirming(false)
    setCopied(false)
  }, [text])

  // Keep the newest streamed text in view unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (!el || !loading) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight
  }, [text, loading])

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(timer)
  }, [confirming])

  const hasText = Boolean(text)
  return (
    <section className="sc-card-body" aria-live="polite">
      <header className="sc-card-head">
        {action && <span className="sc-card-title"><action.icon />{action.name}</span>}
        <span className="sc-card-meta">{meta}</span>
        {loading && (
          <button type="button" className="sc-ghost ml-auto" onClick={onStop} title="Stop · Esc">
            <StopIcon /> Stop
          </button>
        )}
      </header>

      {(hasText || loading || error) && (
        <div ref={scroller} className="sc-answer">
          {error && <p className="sc-error">{error}</p>}
          {hasText && <RichText text={text} />}
          {loading && !hasText && <Thinking />}
        </div>
      )}

      {!loading && (sources.length > 0 || searchQueries.length > 0) && (
        <div className="sc-sources" aria-label="Sources">
          {sources.map((source) => (
            <button key={source.url} type="button" className="sc-source" title={source.title} onClick={() => onOpenLink(source.url)}>
              <GlobeIcon /> {source.title}
            </button>
          ))}
          {searchQueries.map((query) => (
            <button key={query} type="button" className="sc-source is-search" title="Search on Google" onClick={() => onOpenLink(`https://www.google.com/search?q=${encodeURIComponent(query)}`)}>
              G · {query}
            </button>
          ))}
        </div>
      )}

      {(hasText || error) && !loading && (
        <footer className="sc-card-foot">
          <span className="sc-notice">{notice}</span>
          {error && <FootButton onClick={onRetry} label="Try again"><RetryIcon /> Retry</FootButton>}
          {hasText && (
            <FootButton
              label="Copy"
              onClick={() => void onCopy().then((ok) => {
                if (!ok) return
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              })}
            >
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy'}
            </FootButton>
          )}
          {hasText && canApply && applyMode !== 'clipboard' && (
            <button
              type="button"
              className={`sc-primary ${confirming ? 'is-confirming' : ''}`}
              title={confirming ? `This changes ${appName}. Click again to confirm.` : `Put this into ${appName}`}
              onClick={() => {
                if (!confirming) {
                  setConfirming(true)
                  return
                }
                setConfirming(false)
                onApply()
              }}
            >
              <InsertIcon /> {confirming ? `Confirm ${APPLY_LABEL[applyMode].toLowerCase()}` : APPLY_LABEL[applyMode]}
            </button>
          )}
        </footer>
      )}
    </section>
  )
}

export function Composer({
  value,
  placeholder,
  disabled,
  autoFocus,
  onChange,
  onSubmit
}: {
  value: string
  placeholder: string
  disabled?: boolean
  autoFocus?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [autoFocus])

  // Grow with the text, up to five lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 108)}px`
  }, [value])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (value.trim() && !disabled) onSubmit()
    }
  }

  return (
    <div className="sc-composer">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck
      />
      <button type="button" className="sc-send" disabled={disabled || !value.trim()} onClick={onSubmit} aria-label="Send">
        <SendIcon />
      </button>
    </div>
  )
}

function FootButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="sc-ghost" title={label} onClick={onClick}>{children}</button>
}

function Thinking() {
  return (
    <p className="sc-thinking" aria-label="Thinking">
      <span /><span /><span />
    </p>
  )
}

/** Paragraphs, inline `code`, **bold**, bullet lists and fenced code blocks. Rendered as React nodes, never as HTML. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/```/g)
  return (
    <div className="sc-rich">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const newline = part.indexOf('\n')
          const lang = newline > 0 ? part.slice(0, newline).trim() : ''
          const code = newline >= 0 && /^[\w+#.-]*$/.test(lang) ? part.slice(newline + 1) : part
          return <pre key={index}><code>{code.replace(/\n$/, '')}</code></pre>
        }
        return <Blocks key={index} text={part} />
      })}
    </div>
  )
}

function Blocks({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        if (lines.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line))) {
          const ordered = /^\s*\d/.test(lines[0])
          const items = lines.map((line, i) => <li key={i}><Inline text={line.replace(/^\s*([-*•]|\d+[.)])\s+/, '')} /></li>)
          return ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>
        }
        const heading = block.match(/^#{1,4}\s+(.*)$/)
        if (heading && lines.length === 1) return <p key={index} className="sc-h"><Inline text={heading[1]} /></p>
        return <p key={index}><Inline text={block} /></p>
      })}
    </>
  )
}

function Inline({ text }: { text: string }) {
  const tokens = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)
  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith('`') && token.endsWith('`') && token.length > 2) return <code key={index}>{token.slice(1, -1)}</code>
        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) return <strong key={index}>{token.slice(2, -2)}</strong>
        return <span key={index}>{token}</span>
      })}
    </>
  )
}
