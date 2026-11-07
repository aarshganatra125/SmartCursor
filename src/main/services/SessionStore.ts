import type { ApplyMode, ContextSnapshot } from '@shared/types'

export interface LiveSession {
  snapshot: ContextSnapshot
  response: string
  insertText: string
  directApply: ApplyMode
  applyBlockedReason?: string
}

export class SessionStore {
  private sessions = new Map<string, LiveSession>()

  set(id: string, session: LiveSession): void {
    this.sessions.set(id, session)
  }

  get(id: string): LiveSession | null {
    return this.sessions.get(id) ?? null
  }

  update(id: string, patch: Partial<LiveSession>): LiveSession | null {
    const current = this.sessions.get(id)
    if (!current) return null
    const next = { ...current, ...patch, snapshot: patch.snapshot ?? current.snapshot }
    this.sessions.set(id, next)
    return next
  }
}
