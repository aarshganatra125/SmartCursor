import { describe, expect, it } from 'vitest'
import { actionTarget, applyWorkspaceDestination, checkAction, completedGoalSummary, normalizeKeys, parseAgentAction, resolveHomePath, SMARTCURSOR_JIRA_BACKLOG_URL, type AgentAction, type GuardContext } from '../src/shared/agent'
import { buildAgentPrompt } from '../src/shared/prompts'

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
    expect(checkAction(click('Done'), ctx).decision).toBe('confirm')
    expect(checkAction(click('Mark as complete'), ctx).decision).toBe('confirm')
    expect(checkAction({ kind: 'key', keys: 'return', risky: false, reason: '' }, ctx).decision).toBe('confirm')
  })

  it('does not interrupt Allow all for a chat-thread selection merely marked risky by the model', () => {
    expect(checkAction(click('Dev Gandhi', true), { ...ctx, allowAll: true }).decision).toBe('allow')
    expect(checkAction(click('Send', true), { ...ctx, allowAll: true }).decision).toBe('confirm')
  })

  it('allows an exact message to its named recipient in Allow all mode', () => {
    const sendGoal = {
      ...ctx,
      allowAll: true,
      goal: 'Send Hi message to Dev Gandhi.',
      history: ['click “Dev Gandhi”', 'type “Hi”']
    }
    expect(checkAction(click('Send'), sendGoal).decision).toBe('allow')
    expect(checkAction({ kind: 'key', keys: 'return', risky: false, reason: '' }, sendGoal).decision).toBe('allow')
    expect(checkAction(click('Send'), { ...sendGoal, goal: 'Send a message to Dev Gandhi.' }).decision).toBe('confirm')
  })

  it('allows a status change only for the exact Jira issue explicitly named in the workflow goal', () => {
    const jira = { ...ctx, goal: 'Commit and push to the test branch, then mark SCRUM-8 as done.', history: [] }
    expect(checkAction(click('To Do dropdown for SCRUM-8'), jira).decision).toBe('allow')
    expect(checkAction(click('Done'), { ...jira, history: ['click “To Do dropdown for SCRUM-8”'] }).decision).toBe('allow')
    expect(checkAction(click('To Do dropdown for SCRUM-9'), jira).decision).toBe('confirm')
    expect(checkAction(click('To Do dropdown for SCRUM-8'), { ...jira, goal: 'Mark my tasks assigned to me as done.' }).decision).toBe('confirm')
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

describe('workflow progression', () => {
  it('gives an app launch and a same-named click one shared target identity', () => {
    expect(actionTarget({ kind: 'open_app', name: 'Apple Music', risky: false, reason: '' })).toBe('apple music')
    expect(actionTarget(click('Apple Music'))).toBe('apple music')
  })

  it('does not treat repeatable navigation and playback controls as a completed target', () => {
    expect(actionTarget(click('Next'))).toBeNull()
    expect(actionTarget(click('Play'))).toBeNull()
  })

  it('recognizes unambiguous final workflow controls without another model pass', () => {
    expect(completedGoalSummary('Open Apple Music and play Favourite Songs', click('Play'))).toBe('Playback started.')
    expect(completedGoalSummary('Open Apple Music', { kind: 'open_app', name: 'Apple Music', risky: false, reason: '' })).toBe('Opened Apple Music.')
    expect(completedGoalSummary('Open Apple Music and play Favourite Songs', { kind: 'open_app', name: 'Apple Music', risky: false, reason: '' })).toBeNull()
  })

  it('always resolves a Jira workflow to the configured SmartCursor backlog', () => {
    const action = applyWorkspaceDestination('Open Jira', { kind: 'open_url', url: 'https://jira.com', risky: false, reason: '' })
    expect(action).toMatchObject({ kind: 'open_url', url: SMARTCURSOR_JIRA_BACKLOG_URL })
    const app = applyWorkspaceDestination('Open Jira', { kind: 'open_app', name: 'Jira', risky: false, reason: '' })
    expect(app).toMatchObject({ kind: 'open_url', url: SMARTCURSOR_JIRA_BACKLOG_URL })
  })

  it('safely plans a staged-only VS Code commit and push followed by completing SCRUM-8 in Jira', () => {
    const goal = 'Commit and push my latest code to the test branch from VS Code, with message testing, then go to Jira in Chrome and mark my SCRUM-8 ticket as done.'
    const prompt = buildAgentPrompt(goal, 'Visual Studio Code', [], [])

    // The planner receives the branch-verification requirement before it can offer a push.
    expect(prompt).toContain('active VS Code branch exactly matches the branch named in the goal')
    expect(prompt).toMatch(/never use a terminal/i)
    expect(prompt).toContain('use only files that are already staged')
    expect(prompt).toContain('Type the exact commit message supplied in the goal')
    expect(prompt).toContain('Only after a successful push may you open Jira')
    expect(prompt).toContain('exact issue key')

    // Staging is never automated. Publishing and changing a Jira issue are always separately
    // approved—even in Allow all.
    expect(checkAction(click('Stage All Changes'), { ...ctx, frontBundleId: 'com.microsoft.VSCode', frontAppName: 'Visual Studio Code' }).decision).toBe('block')
    expect(checkAction(click('Commit'), { ...ctx, frontBundleId: 'com.microsoft.VSCode', frontAppName: 'Visual Studio Code' }).decision).toBe('confirm')
    expect(checkAction(click('Push'), { ...ctx, frontBundleId: 'com.microsoft.VSCode', frontAppName: 'Visual Studio Code' }).decision).toBe('confirm')
    expect(checkAction(click('Done'), { ...ctx, frontBundleId: 'com.google.Chrome', frontAppName: 'Google Chrome' }).decision).toBe('confirm')

    // The Jira navigation action is pinned to the intended project backlog.
    expect(applyWorkspaceDestination(goal, { kind: 'open_url', url: 'https://jira.com', risky: false, reason: '' }))
      .toMatchObject({ kind: 'open_url', url: SMARTCURSOR_JIRA_BACKLOG_URL })
  })
})
