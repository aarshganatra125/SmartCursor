import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dialog, globalShortcut, screen, shell, type Display } from 'electron'
import { AGENT_LIMITS, actionTarget, applyWorkspaceDestination, checkAction, completedGoalSummary, describeAction, normalizeKeys, resolveHomePath, type AgentAction } from '@shared/agent'
import { isOwnApplication } from '@shared/categorize'
import { boxToScreen } from '@shared/geometry'
import { errorMessage } from '../errors'
import { log } from '../logger'
import type { AIService } from './AIService'
import type { DesktopWindowManager } from './DesktopWindowManager'
import type { NativeBridge } from './NativeBridge'
import type { ScreenshotService } from './ScreenshotService'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Run {
  stopped: boolean
  display: Display
}

/**
 * "Do it" mode: SmartCursor operates the Mac for the user, one action at a time.
 * Each step: screenshot → Gemini picks ONE action → guardrails (plain code) → approval if needed → act.
 *  - 'ask'  mode asks before every action.
 *  - 'auto' mode ("allow all") runs ordinary steps itself; risky ones still always ask.
 * Esc stops it. At most AGENT_LIMITS.steps actions and AGENT_LIMITS.ms milliseconds per run.
 */
export class ComputerAgent {
  private current: Run | null = null

  constructor(
    private bridge: NativeBridge,
    private screenshots: ScreenshotService,
    private ai: AIService,
    private windows: DesktopWindowManager
  ) {}

  running(): boolean {
    return this.current !== null
  }

  stop(): void {
    if (this.current) this.current.stopped = true
  }

  async start(input: { goal: string; mode: 'ask' | 'auto'; appName: string; bundleId: string }): Promise<void> {
    this.stop()
    if (!this.bridge.installed) {
      this.message(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), 'Do it needs the macOS helper. Run npm run build:native.', 6000)
      return
    }
    const run: Run = { stopped: false, display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) }
    this.current = run
    const escape = globalShortcut.register('Escape', () => { run.stopped = true })
    const deadline = Date.now() + AGENT_LIMITS.ms
    const history: string[] = []
    const notes: string[] = []
    const operatedTargets = new Set<string>()
    const preventedDuplicates = new Map<string, number>()
    let previousAction: AgentAction | null = null
    let front = { bundleId: input.bundleId, name: input.appName }
    let finished = false
    log.info('Agent started', { mode: input.mode })

    try {
      for (let step = 1; step <= AGENT_LIMITS.steps; step += 1) {
        if (run.stopped) break
        if (Date.now() > deadline) {
          this.message(run.display, 'Stopped: the two-minute limit was reached.', 6000)
          finished = true
          break
        }
        this.windows.hideGhost()
        // Normal clicks and sidebar transitions should feel immediate. Launching an app or URL
        // gets a little longer so the next screenshot reflects the newly opened interface.
        const settledAfterLaunch = previousAction?.kind === 'open_app' || previousAction?.kind === 'open_url'
        await sleep(step === 1 ? 120 : settledAfterLaunch ? 900 : 350)
        front = await this.frontmost(front)

        let image: string
        try {
          image = await this.screenshots.captureDisplay({ id: run.display.id, width: run.display.size.width, height: run.display.size.height, scaleFactor: run.display.scaleFactor })
        } catch (error) {
          this.message(run.display, errorMessage(error), 6000)
          finished = true
          break
        }
        if (run.stopped) break
        this.windows.showGhost(run.display.bounds, (origin) => ({ kind: 'searching', query: `${input.goal} · step ${step}`, pointer: this.pointer(origin) }), 50_000)

        const decision = await this.ai.decide({ goal: input.goal, appName: front.name, history, notes, jpegBase64: image })
        if (run.stopped) break
        if (!decision.ok) {
          // A request can succeed on screen and then hit a transient model error on the otherwise
          // unnecessary next planning pass. Preserve the completed work instead of presenting it
          // as though the workflow itself failed.
          const last = history.filter((item) => !item.startsWith('(prevented duplicate)')).at(-1)
          this.message(run.display, last ? `Completed the last visible step ✓ ${last}` : decision.error, 6000)
          finished = true
          break
        }
        const action = applyWorkspaceDestination(input.goal, decision.action)
        if (action.kind === 'done') {
          this.message(run.display, `Done ✓ ${action.summary}`.trim(), 6000)
          finished = true
          break
        }
        if (action.kind === 'fail') {
          this.message(run.display, `Could not finish: ${action.summary || 'no safe way to do that.'}`, 7000)
          finished = true
          break
        }

        const target = actionTarget(action)
        if (target && operatedTargets.has(target)) {
          const attempts = (preventedDuplicates.get(target) ?? 0) + 1
          preventedDuplicates.set(target, attempts)
          const note = `“${target}” was already operated. Do not repeat it; choose the next distinct action.`
          history.push(`(prevented duplicate) ${describeAction(action)}`)
          notes.push(note)
          if (attempts >= 2) {
            this.message(run.display, `Stopped: it kept trying “${target}” after that step was already complete.`, 7000)
            finished = true
            break
          }
          // Take a fresh screenshot and re-plan instead of turning a repeated suggestion into a click.
          continue
        }

        const verdict = checkAction(action, { frontBundleId: front.bundleId, frontAppName: front.name, homeDir: homedir(), history })
        log.info('Agent step', { step, kind: action.kind, verdict: verdict.decision })
        if (verdict.decision === 'block') {
          this.message(run.display, `Stopped for safety: ${verdict.why}`, 8000)
          finished = true
          break
        }

        const description = describeAction(action)
        this.preview(run.display, action, step, description)
        if (verdict.decision === 'confirm' || input.mode === 'ask') {
          const choice = await this.confirm(description, verdict.decision === 'confirm' ? verdict.why : undefined)
          if (choice === 'stop' || run.stopped) break
          if (choice === 'skip') {
            history.push(`(user skipped) ${description}`)
            continue
          }
        } else {
          // A beat to see what is about to happen, and to press Esc.
          await sleep(250)
          if (run.stopped) break
        }

        const result = await this.execute(action, front, run.display)
        history.push(description)
        if (target) operatedTargets.add(target)
        previousAction = action
        if (result.note) notes.push(result.note)
        if (!result.ok) {
          this.message(run.display, result.error ?? 'That step did not work.', 7000)
          finished = true
          break
        }
        const completion = completedGoalSummary(input.goal, action)
        if (completion) {
          this.message(run.display, `Done ✓ ${completion}`, 6000)
          finished = true
          break
        }
        if (step === AGENT_LIMITS.steps) {
          this.message(run.display, `Stopped after ${AGENT_LIMITS.steps} steps. Ask again to continue.`, 7000)
          finished = true
        }
      }
      if (run.stopped && !finished) this.message(run.display, 'Stopped.', 2500)
    } finally {
      if (escape) globalShortcut.unregister('Escape')
      if (this.current === run) this.current = null
      log.info('Agent finished', { steps: history.length, stopped: run.stopped })
    }
  }

  private async execute(action: AgentAction, front: { bundleId: string; name: string }, display: Display): Promise<{ ok: boolean; error?: string; note?: string }> {
    try {
      switch (action.kind) {
        case 'click': {
          const box = boxToScreen(action.box, display.bounds)
          await this.activate(front.bundleId)
          return this.helper(['click', String(box.x + box.width / 2), String(box.y + box.height / 2), action.double ? '2' : '1'])
        }
        case 'type': {
          const secure = await this.bridge.call(['focused-secure'], 2000).catch(() => ({ secure: false }))
          if (secure.secure === true) return { ok: false, error: 'Stopped for safety: that is a password field. SmartCursor does not type there.' }
          await this.activate(front.bundleId)
          const typed = await this.helper(['type', action.text], 8000)
          if (!typed.ok || !action.submit) return typed
          return this.helper(['key', 'return'])
        }
        case 'key':
          await this.activate(front.bundleId)
          return this.helper(['key', normalizeKeys(action.keys)])
        case 'scroll':
          // Positive wheel values scroll up.
          return this.helper(['scroll', action.direction === 'down' ? '-500' : '500'])
        case 'find_files':
          return this.findFiles(action.query)
        case 'open_path': {
          const path = resolveHomePath(action.path, homedir())
          if (!path) return { ok: false, error: 'That path is outside your home folder.' }
          try {
            statSync(path)
          } catch {
            return { ok: true, note: `open_path ${action.path}: it does not exist. Search with find_files first.` }
          }
          const failure = await shell.openPath(path)
          return failure ? { ok: false, error: `Could not open it: ${failure}` } : { ok: true }
        }
        case 'open_app':
          await runTool('open', ['-a', action.name], 6000)
          return { ok: true }
        case 'open_url':
          await shell.openExternal(new URL(action.url).toString())
          return { ok: true }
        default:
          return { ok: false, error: 'Unsupported step.' }
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /** Spotlight search by name inside the home folder. Results go back to the model as a note. */
  private async findFiles(query: string): Promise<{ ok: boolean; note: string }> {
    const home = homedir()
    const output = await runTool('mdfind', ['-onlyin', home, '-name', query], 6000).catch(() => '')
    const paths = output.split('\n').map((line) => line.trim()).filter((line) => line && !line.includes('/Library/') && !/\/\.[^/]+/.test(line.slice(home.length)))
    const ranked = paths.sort((a, b) => a.length - b.length).slice(0, 10)
    if (ranked.length === 0) return { ok: true, note: `find_files "${query}": no matches in the home folder.` }
    const lines = ranked.map((path) => {
      let kind = 'file'
      try { kind = statSync(path).isDirectory() ? 'folder' : 'file' } catch { /* vanished */ }
      return `- ${path} (${kind})`
    })
    return { ok: true, note: `find_files "${query}" found:\n${lines.join('\n')}` }
  }

  private async helper(args: string[], timeoutMs = 4000): Promise<{ ok: boolean; error?: string }> {
    const result = await this.bridge.call(args, timeoutMs)
    if (result.ok === false) {
      return { ok: false, error: result.error === 'accessibility-denied' ? 'Do it needs Accessibility permission for the app that runs SmartCursor.' : 'macOS refused that step.' }
    }
    return { ok: true }
  }

  private async activate(bundleId: string): Promise<void> {
    if (!bundleId) return
    await this.bridge.call(['activate', bundleId], 2000).catch(() => undefined)
    await sleep(100)
  }

  private async frontmost(previous: { bundleId: string; name: string }): Promise<{ bundleId: string; name: string }> {
    const result = await this.bridge.call(['frontmost'], 2000).catch(() => null)
    if (!result || result.ok === false) return previous
    const name = typeof result.name === 'string' ? result.name : ''
    const bundleId = typeof result.bundleId === 'string' ? result.bundleId : ''
    // SmartCursor's own approval dialog may be in front; keep working on the user's app.
    if (isOwnApplication(name, bundleId)) return previous
    return { bundleId, name }
  }

  private async confirm(description: string, why?: string): Promise<'allow' | 'skip' | 'stop'> {
    const { response } = await dialog.showMessageBox({
      type: why ? 'warning' : 'question',
      buttons: ['Allow', 'Skip', 'Stop'],
      defaultId: why ? 1 : 0,
      cancelId: 2,
      message: why ?? `SmartCursor wants to ${description}.`,
      detail: why ? `Next step: ${description}. This could change or send something, so it always asks.` : 'Esc stops at any time.'
    })
    return response === 0 ? 'allow' : response === 1 ? 'skip' : 'stop'
  }

  private preview(display: Display, action: AgentAction, step: number, description: string): void {
    if (action.kind === 'click') {
      const box = boxToScreen(action.box, display.bounds)
      this.windows.showGhost(display.bounds, (origin) => ({
        kind: 'found',
        query: description,
        step,
        final: false,
        verb: action.double ? 'Double-clicking' : 'Clicking',
        label: action.label || 'this',
        hint: 'Esc to stop',
        pointer: this.pointer(origin),
        target: { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
      }), 60_000)
      return
    }
    this.message(display, `Step ${step} · ${capitalize(description)} — Esc to stop`, 60_000)
  }

  private message(display: Display, text: string, ms: number): void {
    this.windows.showGhost(display.bounds, (origin) => ({ kind: 'message', text, pointer: this.pointer(origin) }), ms)
  }

  private pointer(origin: { x: number; y: number }): { x: number; y: number } {
    const point = screen.getCursorScreenPoint()
    return { x: point.x - origin.x, y: point.y - origin.y }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Run a fixed system tool with arguments (never through a shell). */
function runTool(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1_000_000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}
