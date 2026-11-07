import type { BridgeResult } from '@shared/protocol'
import type { IntegrationServer } from './IntegrationServer'

export class VSCodeIntegration {
  constructor(private server: IntegrationServer) {}

  connected(): boolean {
    return this.server.snapshot().vscode.connected
  }

  requestContext(): Promise<BridgeResult | null> {
    return this.server.request('vscode', { type: 'request-context' }, 900)
  }

  applyEdit(text: string): Promise<BridgeResult | null> {
    return this.server.request('vscode', { type: 'apply-edit', text }, 2500)
  }
}
