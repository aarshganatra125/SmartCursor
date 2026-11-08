import { describe, expect, it } from 'vitest'
import { categorizeApp } from '../src/shared/categorize'
import { boxToScreen, choosePlacement, companionFrozen, placePopup } from '../src/shared/geometry'
import { buildLocatePrompt, buildMessages } from '../src/shared/prompts'
import { parseBridgeContext, parseBridgeResult, parseClientId, parseFocusedAt, parseInstanceId } from '../src/shared/protocol'
import { extractInsertable, isAccelerator, parseLocateResult } from '../src/shared/text'
import type { ContextSnapshot } from '../src/shared/types'

const snapshot: ContextSnapshot = {
  id: '1',
  capturedAt: 1,
  app: { name: 'Visual Studio Code', bundleId: 'com.microsoft.VSCode', pid: 1, windowTitle: 'app.ts', category: 'editor' },
  selection: 'const value = broken',
  selectionSource: 'vscode',
  warnings: [],
  vscode: { fileName: 'app.ts', languageId: 'typescript', surrounding: 'function around() {}', diagnostics: [{ message: 'Cannot find name', severity: 'error', line: 4 }] }
}

describe('popup placement', () => {
  const display = { x: 1920, y: 0, width: 1440, height: 900 }

  it('opens just below the cursor on the display that contains it', () => {
    const position = placePopup({ cursorX: 2400, cursorY: 200, width: 380, height: 72, display, placement: 'below' })
    expect(position.x).toBeLessThan(2400)
    expect(position.x).toBeGreaterThan(2400 - 40)
    expect(position.y).toBeGreaterThan(200)
    expect(position.y).toBeLessThan(200 + 30)
  })

  it('opens above the cursor near the bottom edge and keeps growing upward', () => {
    expect(choosePlacement(860, display)).toBe('above')
    expect(choosePlacement(100, display)).toBe('below')
    const small = placePopup({ cursorX: 2400, cursorY: 860, width: 380, height: 72, display, placement: 'above' })
    const tall = placePopup({ cursorX: 2400, cursorY: 860, width: 420, height: 400, display, placement: 'above' })
    expect(small.y + 72).toBeLessThan(860)
    expect(tall.y + 400).toBe(small.y + 72)
  })

  it('never leaves the display', () => {
    const position = placePopup({ cursorX: 3355, cursorY: 5, width: 420, height: 500, display, placement: 'below' })
    expect(position.x).toBeGreaterThanOrEqual(1920)
    expect(position.x + 420).toBeLessThanOrEqual(1920 + 1440)
    expect(position.y).toBeGreaterThanOrEqual(0)
    expect(position.y + 500).toBeLessThanOrEqual(900)
  })
})

describe('toolbar following the pointer', () => {
  const popup = { x: 500, y: 300, width: 360, height: 72 }

  it('keeps following while the pointer moves away or sideways', () => {
    expect(companionFrozen({ frozen: false, last: { x: 480, y: 280 }, pointer: { x: 460, y: 260 }, popup })).toBe(false)
    expect(companionFrozen({ frozen: false, last: { x: 480, y: 280 }, pointer: { x: 480, y: 240 }, popup })).toBe(false)
  })

  it('stops as soon as the pointer heads for it or touches it, so it can be clicked', () => {
    expect(companionFrozen({ frozen: false, last: { x: 480, y: 280 }, pointer: { x: 490, y: 288 }, popup })).toBe(true)
    expect(companionFrozen({ frozen: false, last: { x: 600, y: 330 }, pointer: { x: 601, y: 330 }, popup })).toBe(true)
  })

  it('starts following again once the pointer wanders far off', () => {
    expect(companionFrozen({ frozen: true, last: { x: 300, y: 300 }, pointer: { x: 250, y: 300 }, popup })).toBe(false)
    expect(companionFrozen({ frozen: true, last: { x: 480, y: 300 }, pointer: { x: 460, y: 300 }, popup })).toBe(true)
  })
})

describe('ghost cursor', () => {
  it('maps a 0–1000 box onto the right display, including one left of and above the main display', () => {
    const main = { x: 0, y: 0, width: 1440, height: 900 }
    const left = { x: -1920, y: -180, width: 1920, height: 1080 }
    expect(boxToScreen([500, 500, 600, 600], main)).toEqual({ x: 720, y: 450, width: 144, height: 90 })
    const onLeft = boxToScreen([0, 0, 100, 100], left)
    expect(onLeft).toEqual({ x: -1920, y: -180, width: 192, height: 108 })
    // Swapped or out-of-range values are tidied up instead of drawing off-screen.
    expect(boxToScreen([1200, 900, 950, -5], main)).toEqual({ x: 0, y: 855, width: 1296, height: 45 })
  })

  it('reads the model answer even with code fences, and rejects junk', () => {
    const found = parseLocateResult('```json\n{"found": true, "label": "Export", "hint": "Then choose PDF.", "box_2d": [10, 20, 30, 40]}\n```')
    expect(found).toEqual({ found: true, final: false, done: false, label: 'Export', hint: 'Then choose PDF.', box: [10, 20, 30, 40] })
    expect(parseLocateResult('{"found": true, "label": "X"}')?.found).toBe(false)
    expect(parseLocateResult('{"found": false, "hint": "Usually under File."}')?.hint).toBe('Usually under File.')
    expect(parseLocateResult('no json here')).toBeNull()
  })

  it('knows the last step of a multi-step path and when the goal is already done', () => {
    expect(parseLocateResult('{"found": true, "final": true, "label": "Brightness", "box_2d": [1, 2, 3, 4]}')?.final).toBe(true)
    const done = parseLocateResult('{"found": false, "done": true, "final": true, "hint": "Brightness is already at max."}')
    expect(done).toMatchObject({ found: false, done: true, final: false })
  })

  it('tells the model which steps were already clicked', () => {
    const first = buildLocatePrompt('change brightness', 'System Settings')
    const second = buildLocatePrompt('change brightness', 'System Settings', ['Displays'])
    expect(first).toContain('This is the first step')
    expect(second).toContain('1. Displays')
    expect(second).toContain('give only the next one')
  })
})

describe('application categories', () => {
  it('classifies real process identities', () => {
    expect(categorizeApp('Code', 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')).toBe('editor')
    expect(categorizeApp('iTerm2', 'com.googlecode.iterm2')).toBe('terminal')
    expect(categorizeApp('Google Chrome', 'com.google.Chrome')).toBe('browser')
    expect(categorizeApp('Microsoft Outlook', 'com.microsoft.Outlook')).toBe('email')
    expect(categorizeApp('Microsoft Word', 'com.microsoft.Word')).toBe('document')
    expect(categorizeApp('Finder', 'com.apple.finder')).toBe('other')
  })
})

describe('prompts', () => {
  it('changes guidance for the active application and omits context the user turned off', () => {
    const editor = buildMessages({ snapshot, action: 'debug', instruction: 'Why does this fail?', include: { surrounding: false, diagnostics: true, page: false, ocr: false }, history: [] })
    const browser = buildMessages({
      snapshot: { ...snapshot, app: { ...snapshot.app, name: 'Google Chrome', category: 'browser' } },
      action: 'summarize',
      instruction: '',
      include: { surrounding: true, diagnostics: true, page: false, ocr: false },
      history: []
    })
    expect(editor[0].content).toContain('Visual Studio Code')
    expect(editor[0].content).toContain('code editor')
    expect(browser[0].content).toContain('web browser')
    expect(editor.at(-1)?.content).toContain('const value = broken')
    expect(editor.at(-1)?.content).not.toContain('function around()')
    expect(editor.at(-1)?.content).toContain('Cannot find name')
  })
})

describe('live questions', () => {
  it('lets free-form questions use Google Search instead of asking for context', () => {
    const empty = { ...snapshot, selection: '', selectionSource: 'none' as const, vscode: undefined }
    const withSearch = buildMessages({ snapshot: empty, action: 'ask', instruction: 'Man City vs Forest score?', include: { surrounding: false, diagnostics: false, page: false, ocr: false }, history: [], search: true })
    const without = buildMessages({ snapshot: empty, action: 'ask', instruction: 'x', include: { surrounding: false, diagnostics: false, page: false, ocr: false }, history: [] })
    expect(withSearch[0].content).toContain('Google Search')
    expect(withSearch[0].content).not.toContain('Use only the context')
    expect(without[0].content).toContain('Use only the context')
  })
})

describe('protocol', () => {
  it('accepts the default shortcut and an extension result', () => {
    expect(isAccelerator('CommandOrControl+Shift+Space')).toBe(true)
    expect(isAccelerator('Space')).toBe(false)
    expect(parseClientId('chrome')).toBe('chrome')
    expect(parseClientId('browser')).toBeNull()
    const result = parseBridgeResult({ id: '12345678', ok: true, context: { selection: 'hello', fileName: 'app.ts' } })
    expect(result?.context?.selection).toBe('hello')
    expect(parseBridgeResult({ id: 'short', ok: true })).toBeNull()
  })

  it('parses context sent with a right-click open request and multi-window headers', () => {
    const context = parseBridgeContext({ selection: 'x'.repeat(20_000), fileName: 'a.ts', workspaceFolder: '/Users/dev/project', diagnostics: [{ message: 'bad', line: 3 }, 'junk'] })
    expect(context?.selection.length).toBe(12_000)
    expect(context?.workspaceFolder).toBe('/Users/dev/project')
    expect(context?.diagnostics).toEqual([{ message: 'bad', severity: 'info', line: 3 }])
    expect(parseBridgeContext({ url: 'https://example.com' })).toBeNull()
    expect(parseInstanceId('win-1a2B')).toBe('win-1a2B')
    expect(parseInstanceId('../etc')).toBe('default')
    expect(parseInstanceId(undefined)).toBe('default')
    expect(parseFocusedAt('1700000000000')).toBe(1700000000000)
    expect(parseFocusedAt('nope')).toBe(0)
  })

  it('extracts only the insertable draft', () => {
    expect(extractInsertable('Note\n<<<INSERT>>>\nHello\n<<<END>>>\nMore')).toBe('Hello')
    expect(extractInsertable('Plain answer')).toBe('Plain answer')
  })
})
