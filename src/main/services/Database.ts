import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../logger'

export interface ConversationRow {
  id: string
  createdAt: number
  updatedAt: number
  appName: string
  category: string
  title: string
}

export interface MessageRow {
  id: string
  conversationId: string
  role: string
  content: string
  action: string | null
  createdAt: number
}

export interface AppDatabase {
  kind: 'sqlite' | 'json'
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
  insertConversation(row: ConversationRow): void
  touchConversation(id: string, updatedAt: number): void
  insertMessage(row: MessageRow): void
  listConversations(limit: number): ConversationRow[]
  listMessages(conversationId: string): MessageRow[]
  deleteConversation(id: string): void
  deleteAllHistory(): void
  close(): void
}

interface JsonShape {
  settings: Record<string, string>
  conversations: ConversationRow[]
  messages: MessageRow[]
}

class JsonDatabase implements AppDatabase {
  kind = 'json' as const
  private data: JsonShape

  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8')) as JsonShape
    } else {
      this.data = { settings: {}, conversations: [], messages: [] }
      this.flush()
    }
  }

  private flush(): void {
    writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 })
  }

  getSetting(key: string): string | null {
    return this.data.settings[key] ?? null
  }

  setSetting(key: string, value: string): void {
    this.data.settings[key] = value
    this.flush()
  }

  insertConversation(row: ConversationRow): void {
    this.data.conversations.unshift(row)
    this.flush()
  }

  touchConversation(id: string, updatedAt: number): void {
    const row = this.data.conversations.find((item) => item.id === id)
    if (row) row.updatedAt = updatedAt
    this.flush()
  }

  insertMessage(row: MessageRow): void {
    this.data.messages.push(row)
    this.flush()
  }

  listConversations(limit: number): ConversationRow[] {
    return [...this.data.conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  listMessages(conversationId: string): MessageRow[] {
    return this.data.messages.filter((item) => item.conversationId === conversationId)
  }

  deleteConversation(id: string): void {
    this.data.conversations = this.data.conversations.filter((item) => item.id !== id)
    this.data.messages = this.data.messages.filter((item) => item.conversationId !== id)
    this.flush()
  }

  deleteAllHistory(): void {
    this.data.conversations = []
    this.data.messages = []
    this.flush()
  }

  close(): void {
    this.flush()
  }
}

class SqliteDatabase implements AppDatabase {
  kind = 'sqlite' as const

  constructor(private db: SqliteHandle) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        app_name TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        action TEXT,
        created_at INTEGER NOT NULL
      );
    `)
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  insertConversation(row: ConversationRow): void {
    this.db.prepare('INSERT INTO conversations (id, created_at, updated_at, app_name, category, title) VALUES (?, ?, ?, ?, ?, ?)').run(
      row.id, row.createdAt, row.updatedAt, row.appName, row.category, row.title
    )
  }

  touchConversation(id: string, updatedAt: number): void {
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, id)
  }

  insertMessage(row: MessageRow): void {
    this.db.prepare('INSERT INTO messages (id, conversation_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      row.id, row.conversationId, row.role, row.content, row.action, row.createdAt
    )
  }

  listConversations(limit: number): ConversationRow[] {
    const rows = this.db.prepare('SELECT id, created_at, updated_at, app_name, category, title FROM conversations ORDER BY updated_at DESC LIMIT ?').all(limit) as Array<Record<string, string | number>>
    return rows.map(mapConversation)
  }

  listMessages(conversationId: string): MessageRow[] {
    const rows = this.db.prepare('SELECT id, conversation_id, role, content, action, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as Array<Record<string, string | number | null>>
    return rows.map(mapMessage)
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  }

  deleteAllHistory(): void {
    this.db.exec('DELETE FROM messages; DELETE FROM conversations;')
  }

  close(): void {
    this.db.close()
  }
}

interface SqliteHandle {
  exec(sql: string): void
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
  }
  close(): void
}

function mapConversation(row: Record<string, string | number>): ConversationRow {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    appName: String(row.app_name),
    category: String(row.category),
    title: String(row.title)
  }
}

function mapMessage(row: Record<string, string | number | null>): MessageRow {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: String(row.role),
    content: String(row.content),
    action: row.action == null ? null : String(row.action),
    createdAt: Number(row.created_at)
  }
}

export async function openDatabase(file: string): Promise<AppDatabase> {
  mkdirSync(dirname(file), { recursive: true })
  try {
    const sqlite = (await import('node:sqlite')) as { DatabaseSync: new (path: string) => SqliteHandle }
    const db = new sqlite.DatabaseSync(file)
    log.info('Opened SQLite database')
    return new SqliteDatabase(db)
  } catch (error) {
    log.warn('SQLite unavailable, using JSON store', { reason: error instanceof Error ? error.message : 'unknown' })
    return new JsonDatabase(`${file}.json`)
  }
}
