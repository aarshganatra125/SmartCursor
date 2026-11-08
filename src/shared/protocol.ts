import { LIMITS } from './types'
import type { DiagnosticItem } from './types'

export type ClientId = 'chrome' | 'vscode'

export interface BridgeContext {
  selection: string
  url?: string
  title?: string
  pageExcerpt?: string
  fileName?: string
  workspaceFolder?: string
  languageId?: string
  surrounding?: string
  diagnostics?: DiagnosticItem[]
}

export type BridgeRequest =
  | { type: 'request-context'; includePage?: boolean }
  | { type: 'insert-text'; text: string }
  | { type: 'apply-edit'; text: string }
  | { type: 'git-commit-push'; branch: string; message: string; workspaceFolder: string }

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

export function parseBridgeContext(value: unknown): BridgeContext | null {
  if (!isRecord(value) || typeof value.selection !== 'string') return null
  const diagnostics = Array.isArray(value.diagnostics)
    ? value.diagnostics.slice(0, 20).flatMap((item) => {
        if (!isRecord(item) || typeof item.message !== 'string') return []
        return [{
          message: item.message.slice(0, 500),
          severity: typeof item.severity === 'string' ? item.severity.slice(0, 20) : 'info',
          line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : 0
        }]
      })
    : undefined
  return {
    selection: value.selection.slice(0, LIMITS.selection),
    url: asString(value.url, 2000) ?? undefined,
    title: asString(value.title, 500) ?? undefined,
    pageExcerpt: asString(value.pageExcerpt, LIMITS.page) ?? undefined,
    fileName: asString(value.fileName, 300) ?? undefined,
    workspaceFolder: asString(value.workspaceFolder, 1_000) ?? undefined,
    languageId: asString(value.languageId, 80) ?? undefined,
    surrounding: asString(value.surrounding, LIMITS.surrounding) ?? undefined,
    diagnostics
  }
}

export function parseBridgeResult(value: unknown): BridgeResult | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length < 8 || value.id.length > 80) return null
  if (typeof value.ok !== 'boolean') return null
  const error = value.error === undefined ? undefined : asString(value.error, 300) ?? undefined
  if (value.error !== undefined && error === undefined) return null
  let context: BridgeContext | undefined
  if (value.context !== undefined) {
    const parsed = parseBridgeContext(value.context)
    if (!parsed) return null
    context = parsed
  }
  return { id: value.id, ok: value.ok, error, context }
}

/** Instance ids let several VS Code windows poll at once without kicking each other off. */
export function parseInstanceId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'default'
}

export function parseFocusedAt(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : 0
}
