import { describe, expect, it } from 'vitest'
import { checkAction, normalizeKeys, parseAgentAction, resolveHomePath, type AgentAction, type GuardContext } from '../src/shared/agent'

const ctx: GuardContext = { frontBundleId: 'com.google.Chrome', frontAppName: 'Google Chrome', homeDir: '/Users/dev', history: [] }
const click = (label: string, risky = false): AgentAction => ({ kind: 'click', label, box: [1, 1, 2, 2], double: false, risky, reason: '' })

describe('agent action parsing', () => {
  it('reads clicks, tools and finish states, and rejects junk', () => {
    expect(parseAgentAction('{"action":"click","label":"Insert","box_2d":[1,2,3,4]}')).toMatchObject({ kind: 'click', label: 'Insert', double: false })
    expect(parseAgentAction('{"action":"find_files","query":"resume"}')).toMatchObject({ kind: 'find_files', query: 'resume' })
    expect(parseAgentAction('{"action":"done","summary":"Table added"}')).toMatchObject({ kind: 'done', summary: 'Table added' })
    expect(parseAgentAction('{"action":"run_shell","cmd":"rm -rf ~"}')).toBeNull()
    expect(parseAgentAction('{"action":"click","label":"x"}')).toBeNull()
    expect(parseAgentAction('nope')).toBeNull()
  })
})

describe('guardrails', () => {
  it('lets ordinary steps run on their own', () => {
    expect(checkAction(click('Insert'), ctx).decision).toBe('allow')
    expect(checkAction({ kind: 'open_path', path: '~/Documents/Resume', risky: false, reason: '' }, ctx).decision).toBe('allow')
    expect(checkAction({ kind: 'open_url', url: 'https://example.com', risky: false, reason: '' }, ctx).decision).toBe('allow')
  })

  it('always asks before anything that deletes, sends, pays or grants', () => {
    for (const label of ['Delete', 'Move to Trash', 'Send', 'Buy now', 'Allow', 'Empty Bin', 'Sign out']) {
      expect(checkAction(click(label), ctx).decision).toBe('confirm')
    }
    expect(checkAction(click('Next', true), ctx).decision).toBe('confirm')
    expect(checkAction({ kind: 'key', keys: 'return', risky: false, reason: '' }, ctx).decision).toBe('confirm')
  })

  it('blocks destructive shortcuts however they are written', () => {
    for (const keys of ['cmd+backspace', 'Command + Delete', 'shift+cmd+backspace', 'cmd+option+esc', 'ctrl+cmd+q']) {
      expect(checkAction({ kind: 'key', keys, risky: false, reason: '' }, ctx).decision).toBe('block')
    }
    expect(normalizeKeys('Shift + Command + Delete')).toBe('shift+cmd+backspace')
  })

  it('never works inside terminals, disk or password tools, or SmartCursor itself', () => {
    expect(checkAction(click('OK'), { ...ctx, frontBundleId: 'com.apple.Terminal', frontAppName: 'Terminal' }).decision).toBe('block')
    expect(checkAction(click('Erase'), { ...ctx, frontBundleId: 'com.apple.DiskUtility', frontAppName: 'Disk Utility' }).decision).toBe('block')
    expect(checkAction({ kind: 'open_app', name: 'Terminal', risky: false, reason: '' }, ctx).decision).toBe('block')
  })

  it('only opens documents and folders inside home, never programs or system paths', () => {
    const open = (path: string) => checkAction({ kind: 'open_path', path, risky: false, reason: '' }, ctx).decision
    expect(open('/etc/passwd')).toBe('block')
    expect(open('/Users/dev/../other/secret')).toBe('block')
    expect(open('~/Library/Keychains')).toBe('block')
    expect(open('~/Downloads/installer.pkg')).toBe('block')
    expect(open('~/Desktop/run.command')).toBe('block')
    expect(open('~/Desktop/notes.pdf')).toBe('allow')
    expect(resolveHomePath('~/Desktop/', '/Users/dev')).toBe('/Users/dev/Desktop')
  })

  it('refuses card numbers, non-https links and endless loops', () => {
    expect(checkAction({ kind: 'type', text: '4111 1111 1111 1111', submit: false, risky: false, reason: '' }, ctx).decision).toBe('block')
    expect(checkAction({ kind: 'open_url', url: 'file:///etc/hosts', risky: false, reason: '' }, ctx).decision).toBe('block')
    const stuck = { ...ctx, history: ['click “Insert”', 'click “Insert”'] }
    expect(checkAction(click('Insert'), stuck).decision).toBe('block')
  })
})
