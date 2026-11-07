import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export function configureUserData(): void {
  const dir = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'SmartCursor')
    : process.platform === 'win32'
      ? join(process.env.APPDATA || homedir(), 'SmartCursor')
      : join(homedir(), '.config', 'SmartCursor')
  app.setPath('userData', dir)
}

export function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function projectPath(...parts: string[]): string | null {
  return firstExisting([
    join(process.resourcesPath, ...parts),
    join(app.getAppPath(), ...parts),
    join(process.cwd(), ...parts)
  ])
}
