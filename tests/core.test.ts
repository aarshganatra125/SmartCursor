import { describe, expect, it } from 'vitest'
import { categorizeApp } from '../src/shared/categorize'
import { clampWindowPosition } from '../src/shared/geometry'
import { buildMessages } from '../src/shared/prompts'
import { parseBridgeResult, parseClientId } from '../src/shared/protocol'
import { extractInsertable, isAccelerator } from '../src/shared/text'
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

describe('window placement', () => {
  it('keeps the panel on the display that contains the cursor', () => {
    const position = clampWindowPosition({
      cursorX: 3000,
      cursorY: 40,
      windowWidth: 440,
      windowHeight: 700,
      display: { x: 1920, y: 0, width: 1440, height: 900 }
    })
    expect(position.x).toBeGreaterThanOrEqual(1920)
    expect(position.x + 440).toBeLessThanOrEqual(1920 + 1440)
    expect(position.y).toBeGreaterThanOrEqual(0)
    expect(position.y + 700).toBeLessThanOrEqual(900)
  })

  it('flips above the cursor when the panel would leave the bottom of the display', () => {
    const position = clampWindowPosition({
      cursorX: 100,
      cursorY: 800,
      windowWidth: 440,
      windowHeight: 700,
      display: { x: 0, y: 0, width: 1400, height: 900 }
    })
    expect(position.y).toBeLessThan(800)
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

  it('extracts only the insertable draft', () => {
    expect(extractInsertable('Note\n<<<INSERT>>>\nHello\n<<<END>>>\nMore')).toBe('Hello')
    expect(extractInsertable('Plain answer')).toBe('Plain answer')
  })
})
