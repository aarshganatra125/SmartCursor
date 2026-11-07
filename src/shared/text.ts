import { LIMITS } from './types'

export function truncate(value: string, max: number): string {
  const text = value.replace(/\u0000/g, '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[truncated]`
}

export function clipSelection(value: string): string {
  return truncate(value, LIMITS.selection)
}

export function extractInsertable(text: string): string {
  const match = text.match(/<<<INSERT>>>\s*([\s\S]*?)\s*<<<END>>>/)
  return (match?.[1] ?? text).trim()
}

export function preview(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1)}…`
}

export function isModelId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(value)
}

export function isAccelerator(value: string): boolean {
  const parts = value.split('+').filter(Boolean)
  if (parts.length < 2 || parts.length > 4) return false
  const modifiers = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super'])
  const key = parts[parts.length - 1]
  if (!/^[A-Za-z0-9]$/.test(key) && !['Space', 'Tab', 'Enter', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Plus'].includes(key) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return false
  }
  return parts.slice(0, -1).every((part) => modifiers.has(part))
}

export interface LocateResult {
  found: boolean
  /** Using this control completes the goal. */
  final: boolean
  /** The goal is already complete; nothing more to point at. */
  done: boolean
  label: string
  hint: string
  box: [number, number, number, number] | null
}

/** Parse the model's JSON answer to "where is X on this screenshot". Tolerates code fences and stray text. */
export function parseLocateResult(raw: string): LocateResult | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Record<string, unknown>
  const label = typeof value.label === 'string' ? value.label.slice(0, 80) : ''
  const hint = typeof value.hint === 'string' ? value.hint.slice(0, 240) : ''
  const box = Array.isArray(value.box_2d) && value.box_2d.length === 4 && value.box_2d.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? value.box_2d as [number, number, number, number]
    : null
  const found = value.found === true && box !== null
  return { found, final: found && value.final === true, done: !found && value.done === true, label, hint, box: found ? box : null }
}
