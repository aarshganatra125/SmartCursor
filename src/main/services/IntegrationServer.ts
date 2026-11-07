import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ClientConnection, IntegrationSnapshot } from '@shared/types'
import {
  parseBridgeContext,
  parseBridgeResult,
  parseClientId,
  parseFocusedAt,
  parseInstanceId,
  type BridgeCommand,
  type BridgeContext,
  type BridgeRequest,
  type BridgeResult,
  type ClientId
} from '@shared/protocol'
import { log } from '../logger'
import type { SettingsManager } from './SettingsManager'

interface Waiter {
  response: ServerResponse
  timer: NodeJS.Timeout
}

interface Instance {
  focusedAt: number
  seenAt: number
}

/** Fired when an extension asks the desktop app to open the popup (for example from a right-click menu). */
export type OpenListener = (client: ClientId, context: BridgeContext | null) => void

const LIVE_MS = 30_000
const LONG_POLL_MS = 20_000

export class IntegrationServer {
  private server: Server | null = null
  private token = ''
  port: number | null = null
  private lastSeen = new Map<ClientId, number>()
  private queue = new Map<ClientId, BridgeCommand[]>()
  /** Waiting long-polls, per client, per instance (one per VS Code window). */
  private waiters = new Map<ClientId, Map<string, Waiter>>()
  private instances = new Map<ClientId, Map<string, Instance>>()
  private pending = new Map<string, (result: BridgeResult) => void>()
  private listeners = new Set<() => void>()
  private openListener: OpenListener | null = null

  constructor(
    private settings: SettingsManager,
    private bridgePath: string
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onOpenRequest(listener: OpenListener): void {
    this.openListener = listener
  }

  async start(): Promise<void> {
    this.token = this.settings.getToken() || randomBytes(24).toString('hex')
    this.settings.setToken(this.token)
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(() => this.send(response, 400, { ok: false, error: 'bad-request' }))
    })
    const preferred = 17645
    for (let offset = 0; offset < 15; offset += 1) {
      const port = preferred + offset
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            this.server?.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            this.server?.off('error', onError)
            resolve()
          }
          this.server?.once('error', onError)
          this.server?.once('listening', onListening)
          this.server?.listen(port, '127.0.0.1')
        })
        this.port = port
        this.writeBridgeFile()
        log.info('Local integration server listening', { port })
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EADDRINUSE') throw error
      }
    }
    throw new Error('Could not bind the local integration server.')
  }

  stop(): void {
    for (const byInstance of this.waiters.values()) {
      for (const waiter of byInstance.values()) {
        clearTimeout(waiter.timer)
        this.send(waiter.response, 200, { action: null })
      }
    }
    this.waiters.clear()
    this.server?.close()
  }

  snapshot(): IntegrationSnapshot {
    const settings = this.settings.get()
    return {
      port: this.port,
      token: this.token,
      bridgePath: this.bridgePath,
      chrome: this.clientStatus('chrome', settings.integrations.chrome),
      vscode: this.clientStatus('vscode', settings.integrations.vscode)
    }
  }

  rotateToken(): IntegrationSnapshot {
    this.token = randomBytes(24).toString('hex')
    this.settings.setToken(this.token)
    this.lastSeen.clear()
    this.instances.clear()
    this.writeBridgeFile()
    this.emit()
    return this.snapshot()
  }

  request(client: ClientId, command: BridgeRequest, timeoutMs = 1200): Promise<BridgeResult | null> {
    const settings = this.settings.get()
    const enabled = client === 'chrome' ? settings.integrations.chrome : settings.integrations.vscode
    if (!enabled) return Promise.resolve(null)
    const action = { ...command, id: randomUUID() } as BridgeCommand
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(action.id)
        const queued = this.queue.get(client)
        if (queued) this.queue.set(client, queued.filter((item) => item.id !== action.id))
        resolve(null)
      }, timeoutMs)
      this.pending.set(action.id, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      const queued = this.queue.get(client) ?? []
      queued.push(action)
      this.queue.set(client, queued)
      this.flush(client)
    })
  }

  private clientStatus(client: ClientId, enabled: boolean): ClientConnection {
    const seen = this.lastSeen.get(client) ?? null
    return {
      enabled,
      connected: Boolean(enabled && seen && Date.now() - seen < LIVE_MS),
      lastSeen: seen
    }
  }

  private writeBridgeFile(): void {
    mkdirSync(dirname(this.bridgePath), { recursive: true })
    writeFileSync(this.bridgePath, JSON.stringify({ port: this.port, token: this.token, version: 1 }), { mode: 0o600 })
    chmodSync(this.bridgePath, 0o600)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private mark(client: ClientId, instance: string, focusedAt: number): void {
    const before = this.clientStatus(client, true).connected
    const now = Date.now()
    this.lastSeen.set(client, now)
    const known = this.instances.get(client) ?? new Map<string, Instance>()
    const previous = known.get(instance)
    known.set(instance, { focusedAt: Math.max(focusedAt, previous?.focusedAt ?? 0), seenAt: now })
    for (const [id, item] of known) {
      if (now - item.seenAt > LIVE_MS) known.delete(id)
    }
    this.instances.set(client, known)
    const after = this.clientStatus(client, true).connected
    if (before !== after) this.emit()
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Only the Chrome extension (an extension origin) and VS Code (no origin) call this server,
    // and every request must carry the bearer token, so a wildcard origin exposes nothing.
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-SmartCursor-Client, X-SmartCursor-Instance, X-SmartCursor-Focused-At')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const remote = request.socket.remoteAddress
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      response.writeHead(403)
      response.end()
      return
    }
    const header = request.headers.authorization ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!tokensEqual(presented, this.token)) {
      this.send(response, 401, { ok: false, error: 'unauthorized' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const client = parseClientId(url.searchParams.get('client') ?? request.headers['x-smartcursor-client'])
    if (!client) {
      this.send(response, 400, { ok: false, error: 'client-required' })
      return
    }
    const enabled = client === 'chrome' ? this.settings.get().integrations.chrome : this.settings.get().integrations.vscode
    if (!enabled) {
      this.send(response, 403, { ok: false, error: 'integration-disabled' })
      return
    }
    const instance = parseInstanceId(request.headers['x-smartcursor-instance'])
    const focusedAt = parseFocusedAt(request.headers['x-smartcursor-focused-at'])
    this.mark(client, instance, focusedAt)
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      this.send(response, 200, { ok: true, client })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/heartbeat') {
      this.send(response, 200, { ok: true })
      this.flush(client)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/actions') {
      this.poll(client, instance, response)
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/result') {
      const body = parseBridgeResult(await readJson(request))
      if (!body) {
        this.send(response, 400, { ok: false, error: 'invalid-result' })
        return
      }
      const waiter = this.pending.get(body.id)
      this.pending.delete(body.id)
      waiter?.(body)
      this.send(response, 200, { ok: true })
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/open') {
      const body = await readJson(request)
      const context = body && typeof body === 'object' && 'context' in body ? parseBridgeContext((body as { context: unknown }).context) : null
      this.send(response, 200, { ok: true })
      this.openListener?.(client, context)
      return
    }
    this.send(response, 404, { ok: false, error: 'not-found' })
  }

  private poll(client: ClientId, instance: string, response: ServerResponse): void {
    const byInstance = this.waiters.get(client) ?? new Map<string, Waiter>()
    this.waiters.set(client, byInstance)
    const existing = byInstance.get(instance)
    if (existing) {
      // The same window re-polled (for example after regaining focus); release its old request.
      clearTimeout(existing.timer)
      this.send(existing.response, 200, { action: null })
    }
    const timer = setTimeout(() => {
      if (byInstance.get(instance)?.response === response) byInstance.delete(instance)
      this.send(response, 200, { action: null })
    }, LONG_POLL_MS)
    response.on('close', () => {
      clearTimeout(timer)
      if (byInstance.get(instance)?.response === response) byInstance.delete(instance)
    })
    byInstance.set(instance, { response, timer })
    this.flush(client)
  }

  /** Deliver queued commands to the most recently focused live instance, once it is waiting. */
  private flush(client: ClientId): void {
    const queued = this.queue.get(client) ?? []
    const byInstance = this.waiters.get(client)
    if (queued.length === 0 || !byInstance || byInstance.size === 0) return
    const target = this.preferredInstance(client)
    const waiter = target ? byInstance.get(target) : undefined
    if (!target || !waiter || waiter.response.writableEnded) return
    clearTimeout(waiter.timer)
    byInstance.delete(target)
    this.send(waiter.response, 200, { action: queued.shift() })
  }

  private preferredInstance(client: ClientId): string | null {
    const known = this.instances.get(client)
    if (!known) return null
    const now = Date.now()
    let best: string | null = null
    let bestInstance: Instance | null = null
    for (const [id, item] of known) {
      if (now - item.seenAt > LIVE_MS) continue
      if (!bestInstance || item.focusedAt > bestInstance.focusedAt || (item.focusedAt === bestInstance.focusedAt && item.seenAt > bestInstance.seenAt)) {
        best = id
        bestInstance = item
      }
    }
    return best
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    if (response.writableEnded || response.headersSent) return
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 200_000) throw new Error('payload too large')
    chunks.push(buffer)
  }
  if (size === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
