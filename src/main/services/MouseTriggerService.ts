import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { MouseTriggerStatus } from '@shared/types'
import { log } from '../logger'
import type { NativeBridge } from './NativeBridge'
import type { SettingsManager } from './SettingsManager'

export type ClickListener = (point: { x: number; y: number }) => void

/**
 * Global mouse input through the Swift helper (macOS only), which runs as a long-lived
 * `watch-mouse` child process with an event tap:
 *  - Shift + right-click anywhere opens the popup (the click is swallowed so the app's menu stays shut)
 *  - while a ghost-cursor guide waits for the user, left clicks are reported (and still reach the app)
 * The helper runs while either is needed; stdin commands switch each part on or off.
 */
export class MouseTriggerService {
  private child: ChildProcessWithoutNullStreams | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private failures = 0
  private stopping = false
  private clickListener: ClickListener | null = null
  private state: MouseTriggerStatus

  constructor(
    private bridge: NativeBridge,
    private settings: SettingsManager,
    private onTrigger: () => void
  ) {
    this.state = { supported: process.platform === 'darwin', enabled: false, running: false, error: null }
  }

  status(): MouseTriggerStatus {
    return { ...this.state }
  }

  /** True when clicks can actually be observed right now. */
  canWatchClicks(): boolean {
    return this.state.running
  }

  /** Report left clicks to `listener` until it is cleared with null. */
  watchClicks(listener: ClickListener | null): void {
    this.clickListener = listener
    this.sync()
  }

  /** Start, stop or reconfigure the helper to match settings and click watching. */
  sync(): void {
    const triggerOn = this.state.supported && this.settings.get().mouseTrigger
    const clicksOn = this.state.supported && this.clickListener !== null
    this.state.enabled = triggerOn
    if (!triggerOn && !clicksOn) {
      this.stop()
      this.state.error = null
      return
    }
    if (!this.child) {
      this.failures = 0
      this.start()
    } else {
      this.configure()
    }
  }

  stop(): void {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const child = this.child
    this.child = null
    if (child) {
      child.stdin.end()
      child.kill()
    }
    this.state.running = false
    this.stopping = false
  }

  private configure(): void {
    const child = this.child
    if (!child || child.stdin.destroyed) return
    const triggerOn = this.state.supported && this.settings.get().mouseTrigger
    child.stdin.write(`trigger ${triggerOn ? 'on' : 'off'}\nclicks ${this.clickListener ? 'on' : 'off'}\n`)
  }

  private start(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (!this.bridge.binary) {
      this.state.error = 'The macOS helper is not built. Run npm run build:native.'
      return
    }
    const child = spawn(this.bridge.binary, ['watch-mouse'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    let buffer = ''
    let denied = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const message = parseLine(line)
        if (!message) continue
        if (message.event === 'trigger') this.onTrigger()
        else if (message.event === 'click') {
          if (typeof message.x === 'number' && typeof message.y === 'number') this.clickListener?.({ x: message.x, y: message.y })
        } else if (message.event === 'ready') {
          this.failures = 0
          this.state.running = true
          this.state.error = null
          this.configure()
          log.info('Mouse helper ready')
        } else if (message.event === 'error') {
          denied = message.error === 'accessibility-denied' || message.error === 'tap-unavailable'
          this.state.error = denied
            ? 'Shift + right-click needs Accessibility permission for the SmartCursor helper.'
            : 'The mouse helper could not start.'
        }
      }
    })
    child.stderr.resume()
    child.stdin.on('error', () => undefined)
    child.on('error', () => { this.state.error = 'The macOS helper could not be launched.' })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.state.running = false
      if (this.stopping) return
      const wanted = (this.state.supported && this.settings.get().mouseTrigger) || this.clickListener !== null
      if (!wanted) return
      // Without permission, check again now and then so it starts once the user allows it.
      this.failures += 1
      const delay = denied ? 15_000 : Math.min(1000 * 2 ** Math.min(this.failures, 5), 30_000)
      this.restartTimer = setTimeout(() => this.start(), delay)
    })
  }
}

function parseLine(line: string): { event?: string; error?: string; x?: number; y?: number } | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' ? parsed as { event?: string; error?: string; x?: number; y?: number } : null
  } catch {
    return null
  }
}
