import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ApplyMode, WebSource } from '@shared/types'
import type { ActionMeta } from '../actions'
import { CheckIcon, CopyIcon, GlobeIcon, InsertIcon, MicIcon, RetryIcon, SendIcon, StopIcon } from './icons'

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
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const stopTimer = useRef<number | null>(null)
  const voiceBase = useRef('')
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)

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

  useEffect(() => () => stopRecording({ discard: true }), [])

  const toggleVoice = async () => {
    if (listening) {
      stopRecording()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice input is unavailable in this Electron build.')
      return
    }
    setVoiceError(null)
    voiceBase.current = value.trimEnd()
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.current = nextStream
      chunks.current = []
      const mime = recorderMimeType()
      const next = mime ? new MediaRecorder(nextStream, { mimeType: mime }) : new MediaRecorder(nextStream)
      recorder.current = next
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data)
      }
      next.onerror = () => setVoiceError('The microphone recording failed. Try again.')
      next.onstop = () => {
        releaseStream()
        recorder.current = null
        setListening(false)
        const audio = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' })
        chunks.current = []
        if (audio.size === 0) return
        void transcribe(audio, next.mimeType || 'audio/webm')
      }
      next.start()
      setListening(true)
      stopTimer.current = window.setTimeout(() => stopRecording(), 30_000)
    } catch {
      releaseStream()
      setVoiceError('Microphone access was denied or is unavailable. Allow it in macOS Privacy & Security, then try again.')
    }
  }

  const stopRecording = ({ discard = false }: { discard?: boolean } = {}) => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current)
    stopTimer.current = null
    const active = recorder.current
    if (!active || active.state === 'inactive') {
      if (discard) releaseStream()
      return
    }
    if (discard) {
      active.onstop = () => { releaseStream(); recorder.current = null }
      chunks.current = []
    }
    active.stop()
  }

  const releaseStream = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }

  const transcribe = async (audio: Blob, rawMimeType: string) => {
    setTranscribing(true)
    try {
      const result = await window.smartcursor.transcribe(await blobBase64(audio), normalizedMimeType(rawMimeType))
      if (!result.ok) {
        setVoiceError(result.error || 'Voice transcription failed. Try again.')
        return
      }
      const prefix = voiceBase.current && result.text ? `${voiceBase.current} ` : voiceBase.current
      onChange(`${prefix}${result.text.trimStart()}`)
      requestAnimationFrame(() => ref.current?.focus())
    } catch {
      setVoiceError('Voice transcription failed. Try again.')
    } finally {
      setTranscribing(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (value.trim() && !disabled) onSubmit()
    }
  }

  return (
    <div className="sc-composer-wrap">
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
        <button type="button" className={`sc-mic ${listening || transcribing ? 'is-listening' : ''}`} disabled={disabled || transcribing} onClick={() => void toggleVoice()} aria-label={listening ? 'Stop voice input' : 'Start voice input'} title={listening ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Speak your prompt'}>
          <MicIcon />
        </button>
        <button type="button" className="sc-send" disabled={disabled || !value.trim()} onClick={onSubmit} aria-label="Send">
          <SendIcon />
        </button>
      </div>
      {voiceError && <p className="sc-voice-error" role="status">{voiceError}</p>}
    </div>
  )
}

function recorderMimeType(): string | null {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}

function normalizedMimeType(mime: string): 'audio/webm' | 'audio/ogg' | 'audio/mp4' {
  if (mime.startsWith('audio/ogg')) return 'audio/ogg'
  if (mime.startsWith('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const encoded = result.split(',', 2)[1]
      if (encoded) resolve(encoded)
      else reject(new Error('Could not read recording.'))
    }
    reader.readAsDataURL(blob)
  })
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
