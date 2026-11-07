import { useEffect, useState, type ReactNode } from 'react'
import type { GhostPayload } from '@shared/types'

/**
 * Full-display, click-through overlay. It draws one of:
 *  - "searching": a small pill next to the pointer while Gemini looks at the screen
 *  - "found": a ghost pointer that glides from the real pointer to the control, a pulsing ring, and a label
 *  - "message": a pill next to the pointer (not found, no permission, errors)
 */
export function Ghost() {
  const [payload, setPayload] = useState<GhostPayload | null>(null)
  const [run, setRun] = useState(0)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const api = window.smartcursor
    if (!api) return
    void api.bootstrap().then((result) => {
      if (result.bootstrap) setTheme(result.bootstrap.resolvedTheme)
    })
    const stops = [
      api.onTheme(setTheme),
      api.onGhost((next) => {
        setPayload(next)
        setRun((value) => value + 1)
      })
    ]
    return () => stops.forEach((stop) => stop())
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  if (!payload) return null
  if (payload.kind === 'found') return <Found key={run} payload={payload} />
  return (
    <Bubble key={run} at={payload.pointer} busy={payload.kind === 'searching'}>
      {payload.kind === 'searching' ? <>Looking for <strong>“{payload.query}”</strong>…</> : payload.text}
    </Bubble>
  )
}

function Found({ payload }: { payload: Extract<GhostPayload, { kind: 'found' }> }) {
  const [arrived, setArrived] = useState(false)
  const pad = 6
  const ring = {
    left: payload.target.x - pad,
    top: payload.target.y - pad,
    width: payload.target.width + pad * 2,
    height: payload.target.height + pad * 2
  }
  const center = { x: payload.target.x + payload.target.width / 2, y: payload.target.y + payload.target.height / 2 }
  const [position, setPosition] = useState(payload.pointer)

  useEffect(() => {
    // Start at the real pointer, then glide on the next frame so the transition runs.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setPosition(center)))
    const timer = setTimeout(() => setArrived(true), 720)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  // Put the label below the ring, or above it when the ring is near the bottom of the display.
  const below = ring.top + ring.height + 120 < window.innerHeight
  const labelLeft = Math.min(Math.max(ring.left, 12), window.innerWidth - 332)
  const labelStyle = below ? { left: labelLeft, top: ring.top + ring.height + 10 } : { left: labelLeft, top: Math.max(ring.top - 10, 12), transform: 'translateY(-100%)' }

  return (
    <>
      {arrived && <div className="gh-ring" style={ring} />}
      {arrived && <div className="gh-ring gh-ring-echo" style={ring} />}
      <div className="gh-pointer" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
        <PointerArt />
      </div>
      {arrived && (
        <div className="gh-label" style={labelStyle}>
          <p className="gh-label-step">{payload.verb ? `Step ${payload.step} · ${payload.verb}` : payload.final ? (payload.step > 1 ? 'Last step' : 'Here') : `Step ${payload.step}`}</p>
          <p className="gh-label-title">{payload.label}</p>
          {payload.hint && <p className="gh-label-hint">{payload.hint}</p>}
        </div>
      )}
    </>
  )
}

function Bubble({ at, busy, children }: { at: { x: number; y: number }; busy: boolean; children: ReactNode }) {
  const left = Math.min(Math.max(at.x + 18, 12), window.innerWidth - 352)
  const top = Math.min(Math.max(at.y + 18, 12), window.innerHeight - 72)
  return (
    <div className="gh-bubble" style={{ left, top }}>
      <span className={`gh-dot ${busy ? 'is-busy' : ''}`} />
      <span>{children}</span>
    </div>
  )
}

function PointerArt() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="gh-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="45%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M4 2.5 20 11l-7 2-3.4 7.5L4 2.5Z" fill="url(#gh-fill)" stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}
