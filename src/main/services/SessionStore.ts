import type { ApplyMode, ContextSnapshot, HistoryMessage } from '@shared/types'

export interface LiveSession {
  snapshot: ContextSnapshot
  response: string
  insertText: string
  directApply: ApplyMode
  applyBlockedReason?: string
  /** Turns for follow-up questions. Kept in memory so follow-ups work even when history storage is off. */
  turns: HistoryMessage[]
}

/** Every popup opens a session; keep only the most recent few so a long-running menu-bar app does not grow. */
const MAX_SESSIONS = 12

export class SessionStore {
  private sessions = new Map<string, LiveSession>()

  set(id: string, session: LiveSession): void {
    this.sessions.delete(id)
    this.sessions.set(id, session)
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      this.sessions.delete(oldest)
    }
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
