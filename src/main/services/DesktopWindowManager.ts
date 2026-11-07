import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, nativeTheme, screen, type NativeImage, type WebPreferences } from 'electron'
import type { PanelPayload, ThemePreference } from '@shared/types'
import { clampWindowPosition } from '@shared/geometry'
import { Ipc } from '@shared/ipc'

export class DesktopWindowManager {
  private floating: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private tray: Tray | null = null
  private current: PanelPayload | null = null
  private quitting = false

  constructor(private handlers: { openAssistant: () => void; openSettings: () => void }) {}

  create(): void {
    this.floating = this.createFloating()
    this.createTray()
    this.installMenu()
  }

  currentPanel(): PanelPayload | null {
    return this.current
  }

  isFloatingVisible(): boolean {
    return Boolean(this.floating && !this.floating.isDestroyed() && this.floating.isVisible())
  }

  showFloating(payload: PanelPayload): void {
    const win = this.floating
    if (!win || win.isDestroyed()) return
    this.current = payload
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const bounds = win.getBounds()
    const position = clampWindowPosition({
      cursorX: cursor.x,
      cursorY: cursor.y,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
      display: display.workArea
    })
    win.setBounds({ ...position, width: bounds.width, height: bounds.height })
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send(Ipc.panelOpen, payload)
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
    win.show()
    win.focus()
  }

  hideFloating(): void {
    if (this.floating && !this.floating.isDestroyed()) this.floating.hide()
  }

  showSettings(): void {
    if (process.platform === 'darwin') app.dock?.show()
    if (!this.settings || this.settings.isDestroyed()) this.settings = this.createSettings()
    this.settings.show()
    this.settings.focus()
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  setTheme(theme: ThemePreference): void {
    nativeTheme.themeSource = theme
  }

  resolvedTheme(): 'light' | 'dark' {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  private createFloating(): BrowserWindow {
    const win = new BrowserWindow({
      width: 440,
      height: 700,
      minWidth: 380,
      minHeight: 520,
      show: false,
      frame: false,
      transparent: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      roundedCorners: true,
      backgroundColor: '#00000000',
      title: 'SmartCursor',
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
      webPreferences: this.webPreferences()
    })
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      win.hide()
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      console.log(JSON.stringify({ level: 'error', message: 'Floating window failed to load', code, description }))
    })
    this.load(win, 'floating.html')
    return win
  }

  private createSettings(): BrowserWindow {
    const win = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: 'SmartCursor Settings',
      autoHideMenuBar: true,
      backgroundColor: '#f4f4f5',
      webPreferences: this.webPreferences()
    })
    win.on('closed', () => {
      this.settings = null
      if (process.platform === 'darwin' && !this.isFloatingVisible()) app.dock?.hide()
    })
    this.load(win, 'settings.html')
    return win
  }

  private createTray(): void {
    this.tray = new Tray(trayImage())
    this.tray.setToolTip('SmartCursor')
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open SmartCursor', click: () => this.handlers.openAssistant() },
      { label: 'Settings', click: () => this.handlers.openSettings() },
      { type: 'separator' },
      { label: 'Quit SmartCursor', click: () => app.quit() }
    ]))
    this.tray.on('click', () => this.handlers.openAssistant())
  }

  private installMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'SmartCursor',
        submenu: [
          { label: 'Open', click: () => this.handlers.openAssistant() },
          { label: 'Settings', click: () => this.handlers.openSettings() },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' }
    ]))
  }

  prepareToQuit(): void {
    this.quitting = true
  }

  private webPreferences(): WebPreferences {
    return {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false
    }
  }

  private load(win: BrowserWindow, page: string): void {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) {
      const base = devUrl.endsWith('/') ? devUrl : `${devUrl}/`
      void win.loadURL(new URL(page, base).toString())
      return
    }
    void win.loadFile(join(__dirname, '../renderer', page))
  }
}

function trayImage(): NativeImage {
  const size = 22
  const pixels = Buffer.alloc(size * size * 4)
  const center = 10.5
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.abs(x - center) + Math.abs(y - center)
      if (distance > 8) continue
      const offset = (y * size + x) * 4
      pixels[offset + 3] = distance < 6 ? 255 : 120
    }
  }
  const image = nativeImage.createFromBitmap(pixels, { width: size, height: size })
  image.setTemplateImage(true)
  return image
}
