import { randomUUID } from 'node:crypto'
import type { ContextSnapshot, HistoryItem, HistoryMessage } from '@shared/types'
import { preview } from '@shared/text'
import type { AppDatabase } from './Database'
import type { SettingsManager } from './SettingsManager'

export class ConversationManager {
  constructor(
    private db: AppDatabase,
    private settings: SettingsManager
  ) {}

  create(snapshot: ContextSnapshot): string {
    const id = randomUUID()
    if (!this.settings.get().privacy.storeHistory) return id
    const title = preview(snapshot.selection || snapshot.app.windowTitle || snapshot.app.name || 'Conversation', 80)
    const now = Date.now()
    this.db.insertConversation({
      id,
      createdAt: now,
      updatedAt: now,
      appName: snapshot.app.name,
      category: snapshot.app.category,
      title
    })
    return id
  }

  append(conversationId: string, role: HistoryMessage['role'], content: string, action: string | null): void {
    if (!this.settings.get().privacy.storeHistory) return
    this.db.insertMessage({
      id: randomUUID(),
      conversationId,
      role,
      content,
      action,
      createdAt: Date.now()
    })
    this.db.touchConversation(conversationId, Date.now())
  }

  list(limit = 50): HistoryItem[] {
    return this.db.listConversations(limit).map((conversation) => {
      const messages = this.db.listMessages(conversation.id).map((message) => ({
        role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: message.content,
        createdAt: message.createdAt
      }))
      const last = messages[messages.length - 1]
      return {
        id: conversation.id,
        title: conversation.title,
        appName: conversation.appName,
        createdAt: conversation.createdAt,
        preview: preview(last?.content ?? conversation.title, 160),
        messages
      }
    })
  }

  delete(id?: string): void {
    if (id) this.db.deleteConversation(id)
    else this.db.deleteAllHistory()
  }
}
