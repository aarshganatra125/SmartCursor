import type { SmartCursorApi } from '../preload/index'

declare global {
  interface Window {
    smartcursor: SmartCursorApi
  }
}

export {}
