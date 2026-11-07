import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

export class SecureStore {
  constructor(private file: string) {}

  hasApiKey(): boolean {
    return existsSync(this.file)
  }

  hint(): string | null {
    const key = this.read()
    if (!key) return null
    return `••••${key.slice(-4)}`
  }

  read(): string | null {
    if (!existsSync(this.file)) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(readFileSync(this.file))
    } catch {
      return null
    }
  }

  write(apiKey: string): void {
    const trimmed = apiKey.trim()
    if (trimmed.length < 20 || trimmed.length > 300 || /\s/.test(trimmed)) {
      throw new Error('That API key does not look valid.')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS Keychain or Windows secure storage is unavailable, so the API key was not saved.')
    }
    writeFileSync(this.file, safeStorage.encryptString(trimmed), { mode: 0o600 })
    chmodSync(this.file, 0o600)
  }

  clear(): void {
    if (existsSync(this.file)) unlinkSync(this.file)
  }
}
