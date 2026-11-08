import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { VSCodeIntegration } from './VSCodeIntegration'

export interface GitCommitPushRequest {
  branch: string
  message: string
}

export type GitWorkflowResult =
  | { handled: false }
  | { handled: true; ok: true; note: string }
  | { handled: true; ok: false; error: string }

/**
 * Recognize only an explicit, bounded commit-and-push request. The branch and message must both
 * be present in the prompt; SmartCursor never guesses where to publish code.
 */
export function parseGitCommitPushRequest(goal: string): GitCommitPushRequest | null {
  if (!/\bcommit\b/i.test(goal) || !/\bpush\b/i.test(goal)) return null
  const branch = goal.match(/\b(?:to|on|into)\s+(?:the\s+)?([A-Za-z0-9._/-]+)\s+branch\b/i)?.[1]
  const message = goal.match(/\b(?:with\s+)?message\s+["“']?([^"”'.!?]+?)["”']?(?:\s*(?:,|and\s+then|then)\b|[.?!]|$)/i)?.[1]?.trim().replace(/,+$/, '').trim()
  if (!branch || !message || message.length > 200) return null
  return { branch, message }
}

function isCommitPushIntent(goal: string): boolean {
  return /\bcommit\b/i.test(goal) && /\bpush\b/i.test(goal)
}

/** Executes only `git commit -m <message>` then `git push origin <branch>` in a verified repo. */
export class GitWorkflowService {
  constructor(private vscode: VSCodeIntegration) {}

  async run(goal: string, workspaceFolder?: string): Promise<GitWorkflowResult> {
    const request = parseGitCommitPushRequest(goal)
    if (!request) {
      if (isCommitPushIntent(goal)) {
        return { handled: true, ok: false, error: 'Name the target branch and commit message explicitly—for example: “Commit and push my staged code to the test branch from VS Code, with message testing.”' }
      }
      return { handled: false }
    }
    try {
      const root = await resolveRepository(workspaceFolder)
      if (!root) return { handled: true, ok: false, error: 'SmartCursor could not identify a Git repository. Open the project in VS Code, then retry.' }
      await focusVSCode(root)
      const branch = (await git(root, ['branch', '--show-current'])).trim()
      if (branch !== request.branch) {
        return { handled: true, ok: false, error: `The active branch is “${branch || 'detached HEAD'}”, not “${request.branch}”. SmartCursor will not switch branches or push a different branch.` }
      }
      const staged = (await git(root, ['diff', '--cached', '--name-only'])).split('\n').map((line) => line.trim()).filter(Boolean)
      if (staged.length === 0) return { handled: true, ok: false, error: 'There are no staged files to commit. SmartCursor will not add files for you.' }
      const result = await this.vscode.commitAndPush(request.branch, request.message, root)
      if (!result?.ok) return { handled: true, ok: false, error: result?.error || 'VS Code did not complete the Git workflow.' }
      return { handled: true, ok: true, note: `Committed ${staged.length} staged file${staged.length === 1 ? '' : 's'} with “${request.message}” and pushed ${request.branch}.` }
    } catch (error) {
      return { handled: true, ok: false, error: readableGitError(error) }
    }
  }
}

/** Prefer the paired VS Code workspace; in development, fall back to the repository SmartCursor was launched from. */
async function resolveRepository(workspaceFolder?: string): Promise<string | null> {
  const candidates = workspaceFolder && existsSync(workspaceFolder) ? [workspaceFolder] : [process.cwd()]
  for (const candidate of candidates) {
    try {
      const workspace = resolve(candidate)
      const root = (await git(workspace, ['rev-parse', '--show-toplevel'])).trim()
      if (root && (workspace === root || workspace.startsWith(`${root}${sep}`))) return root
    } catch {
      // Try the next trusted candidate.
    }
  }
  return null
}

/** Bring the relevant workspace forward so the user sees the real commit-and-push workflow. */
async function focusVSCode(workspace: string): Promise<void> {
  if (process.platform !== 'darwin') return
  await new Promise<void>((resolve) => {
    execFile('open', ['-a', 'Visual Studio Code', workspace], { timeout: 8_000 }, () => resolve())
  })
  await new Promise((resolve) => setTimeout(resolve, 500))
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 30_000, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()))
      else resolve(stdout)
    })
  })
}

function readableGitError(error: unknown): string {
  const detail = error instanceof Error ? error.message.replace(/\s+/g, ' ').trim() : ''
  if (/nothing to commit/i.test(detail)) return 'Git found nothing staged to commit. SmartCursor did not add any files.'
  if (/author identity unknown/i.test(detail)) return 'Git needs your user name and email configured before it can commit.'
  if (/rejected|non-fast-forward/i.test(detail)) return 'GitHub rejected the push because the remote branch changed. Pull and resolve it in VS Code, then retry.'
  return detail ? `Git could not complete the workflow: ${detail.slice(0, 260)}` : 'Git could not complete the workflow.'
}
