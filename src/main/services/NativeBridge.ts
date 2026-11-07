import { chmodSync } from 'node:fs'
import { runJson } from '../runJson'

export class NativeBridge {
  constructor(readonly binary: string | null) {
    if (binary) {
      try { chmodSync(binary, 0o755) } catch { /* already executable */ }
    }
  }

  get installed(): boolean {
    return Boolean(this.binary)
  }

  async call(args: string[], timeoutMs = 4000): Promise<Record<string, unknown>> {
    if (!this.binary) throw new Error('The macOS helper is not built.')
    return runJson(this.binary, args, timeoutMs)
  }
}
