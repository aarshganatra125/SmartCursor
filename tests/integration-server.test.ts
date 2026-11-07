import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BridgeContext, ClientId } from '../src/shared/protocol'
import { IntegrationServer } from '../src/main/services/IntegrationServer'
import type { SettingsManager } from '../src/main/services/SettingsManager'

function fakeSettings(): SettingsManager {
  let token: string | null = 'a'.repeat(48)
  return {
    get: () => ({ integrations: { chrome: true, vscode: true } }),
    getToken: () => token,
    setToken: (next: string) => { token = next }
  } as unknown as SettingsManager
}

describe('integration server', () => {
  let dir: string
  let server: IntegrationServer
  let base: string
  const token = 'a'.repeat(48)

  const call = (path: string, init: { method?: string; instance?: string; focusedAt?: number; body?: unknown; auth?: string } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${init.auth ?? token}`,
        'Content-Type': 'application/json',
        'X-SmartCursor-Client': 'vscode',
        ...(init.instance ? { 'X-SmartCursor-Instance': init.instance } : {}),
        ...(init.focusedAt ? { 'X-SmartCursor-Focused-At': String(init.focusedAt) } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sc-test-'))
    server = new IntegrationServer(fakeSettings(), join(dir, 'bridge.json'))
    await server.start()
    base = `http://127.0.0.1:${server.port}`
  })

  afterEach(() => {
    server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a wrong token', async () => {
    const response = await call('/v1/health', { auth: 'b'.repeat(48) })
    expect(response.status).toBe(401)
  })

  it('lets two VS Code windows wait at once and sends work to the one focused last', async () => {
    const settled: string[] = []
    const older = call('/v1/actions?client=vscode', { instance: 'older', focusedAt: 100 }).then(async (r) => { settled.push('older'); return r.json() })
    const newer = call('/v1/actions?client=vscode', { instance: 'newer', focusedAt: 200 }).then(async (r) => { settled.push('newer'); return r.json() })
    await new Promise((resolve) => setTimeout(resolve, 60))
    // Before the fix, the second window's poll released the first one, and they looped forever.
    expect(settled).toEqual([])

    const pending = server.request('vscode', { type: 'request-context' }, 2000)
    const delivered = await newer as { action: { id: string; type: string } }
    expect(delivered.action.type).toBe('request-context')
    expect(settled).toEqual(['newer'])

    await call('/v1/result?client=vscode', { method: 'POST', instance: 'newer', body: { id: delivered.action.id, ok: true, context: { selection: 'from newer' } } })
    const result = await pending
    expect(result?.context?.selection).toBe('from newer')

    server.stop()
    expect(((await older) as { action: unknown }).action).toBeNull()
  })

  it('opens the popup with the context an extension sends from its right-click menu', async () => {
    const opened: Array<{ client: ClientId; context: BridgeContext | null }> = []
    server.onOpenRequest((client, context) => opened.push({ client, context }))
    const response = await call('/v1/open?client=vscode', { method: 'POST', body: { context: { selection: 'const x = 1', fileName: 'a.ts' } } })
    expect(response.status).toBe(200)
    expect(opened).toHaveLength(1)
    expect(opened[0].client).toBe('vscode')
    expect(opened[0].context?.selection).toBe('const x = 1')
    expect(opened[0].context?.fileName).toBe('a.ts')
  })
})
