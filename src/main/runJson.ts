import { spawn } from 'node:child_process'

export function runJson(command: string, args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('The system helper timed out.'))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2_000_000) {
        clearTimeout(timer)
        child.kill('SIGKILL')
        reject(new Error('The system helper returned too much data.'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 20) stderr.push(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const text = Buffer.concat(stdout).toString('utf8').trim()
      const line = text.split('\n').filter(Boolean).at(-1) ?? ''
      try {
        const parsed = JSON.parse(line) as unknown
        if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid')
        resolve(parsed as Record<string, unknown>)
      } catch {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 180)
        reject(new Error(detail || 'The system helper returned an unreadable response.'))
      }
    })
  })
}
