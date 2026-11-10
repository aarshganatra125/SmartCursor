import type { BridgeResult } from '@shared/protocol'
import type { IntegrationServer } from './IntegrationServer'

export class ChromeIntegration {
  constructor(private server: IntegrationServer) {}

  connected(): boolean {
    return this.server.snapshot().chrome.connected
  }

  requestContext(includePage: boolean): Promise<BridgeResult | null> {
    return this.server.request('chrome', { type: 'request-context', includePage }, includePage ? 2500 : 900)
  }

  insertText(text: string): Promise<BridgeResult | null> {
    return this.server.request('chrome', { type: 'insert-text', text }, 2500)
  }
}
