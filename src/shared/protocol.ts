import { LIMITS } from './types'
import type { DiagnosticItem } from './types'

export type ClientId = 'chrome' | 'vscode'

export interface BridgeContext {
  selection: string
  url?: string
  title?: string
  pageExcerpt?: string
  fileName?: string
  languageId?: string
  surrounding?: string
  diagnostics?: DiagnosticItem[]
}

export type BridgeRequest =
  | { type: 'request-context'; includePage?: boolean }
  | { type: 'insert-text'; text: string }
  | { type: 'apply-edit'; text: string }

export type BridgeCommand = BridgeRequest & { id: string }

export interface BridgeResult {
  id: string
  ok: boolean
  error?: string
  context?: BridgeContext
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  return value.slice(0, max)
}

export function parseClientId(value: unknown): ClientId | null {
  return value === 'chrome' || value === 'vscode' ? value : null
}

export function parseBridgeResult(value: unknown): BridgeResult | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length < 8 || value.id.length > 80) return null
  if (typeof value.ok !== 'boolean') return null
  const error = value.error === undefined ? undefined : asString(value.error, 300) ?? undefined
  if (value.error !== undefined && error === undefined) return null
  let context: BridgeContext | undefined
  if (value.context !== undefined) {
    if (!isRecord(value.context) || typeof value.context.selection !== 'string') return null
    const diagnostics = Array.isArray(value.context.diagnostics)
      ? value.context.diagnostics.slice(0, 20).flatMap((item) => {
          if (!isRecord(item) || typeof item.message !== 'string') return []
          return [{
            message: item.message.slice(0, 500),
            severity: typeof item.severity === 'string' ? item.severity.slice(0, 20) : 'info',
            line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : 0
          }]
        })
      : undefined
    context = {
      selection: value.context.selection.slice(0, LIMITS.selection),
      url: asString(value.context.url, 2000) ?? undefined,
      title: asString(value.context.title, 500) ?? undefined,
      pageExcerpt: asString(value.context.pageExcerpt, LIMITS.page) ?? undefined,
      fileName: asString(value.context.fileName, 300) ?? undefined,
      languageId: asString(value.context.languageId, 80) ?? undefined,
      surrounding: asString(value.context.surrounding, LIMITS.surrounding) ?? undefined,
      diagnostics
    }
  }
  return { id: value.id, ok: value.ok, error, context }
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}
