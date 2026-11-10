import { describe, expect, it } from 'vitest'
import { GitWorkflowService, parseGitCommitPushRequest } from '../src/main/services/GitWorkflowService'

describe('Git commit-and-push workflow parsing', () => {
  it('requires an explicit branch and commit message', () => {
    expect(parseGitCommitPushRequest('Commit and push my latest code to the test branch from VS Code, with message testing, then open Jira.'))
      .toEqual({ branch: 'test', message: 'testing' })
    expect(parseGitCommitPushRequest('Commit and push my latest code with message testing.')).toBeNull()
    expect(parseGitCommitPushRequest('Push my latest code to the test branch.')).toBeNull()
  })

  it('does not fall back to screen automation when the branch is missing', async () => {
    const result = await new GitWorkflowService({} as never).run('Commit and push my latest code from VS Code, with message testing.', '')
    expect(result).toMatchObject({ handled: true, ok: false })
    expect(result.ok === false && result.error).toContain('Name the target branch')
  })
})
