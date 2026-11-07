import { unlinkSync } from 'node:fs'
import type { NativeBridge } from './NativeBridge'

export class OCRService {
  private worker: { recognize: (image: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null = null

  constructor(private bridge: NativeBridge) {}

  async recognize(file: string): Promise<string> {
    try {
      if (process.platform === 'darwin') {
        if (!this.bridge.installed) throw new Error('The macOS helper is required for on-device OCR.')
        const result = await this.bridge.call(['ocr', file], 20_000)
        if (result.ok === false) throw new Error('On-device OCR could not read that capture.')
        return typeof result.text === 'string' ? result.text : ''
      }
      return this.recognizeWithTesseract(file)
    } finally {
      try { unlinkSync(file) } catch { /* already removed */ }
    }
  }

  private async recognizeWithTesseract(file: string): Promise<string> {
    if (!this.worker) {
      const tesseract = await import('tesseract.js')
      this.worker = await tesseract.createWorker('eng')
    }
    const result = await this.worker.recognize(file)
    return result.data.text ?? ''
  }

  async dispose(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}
