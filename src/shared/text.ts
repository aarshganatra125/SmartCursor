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
