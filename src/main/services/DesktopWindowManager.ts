import { join } from 'node:path'
import { BrowserWindow, Menu, Tray, app, nativeImage, nativeTheme, screen, type NativeImage, type WebPreferences } from 'electron'
import type { GhostPayload, PanelPayload, ThemePreference } from '@shared/types'
import { placePopup, type DisplayRect, type Rect } from '@shared/geometry'
import { Ipc } from '@shared/ipc'

export class DesktopWindowManager {
  private floating: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private tray: Tray | null = null
  private current: PanelPayload | null = null
  private quitting = false
  private anchor: { x: number; y: number; display: DisplayRect } | null = null
  private size = { width: POPUP_START.width, height: POPUP_START.height }
  private revealTimer: NodeJS.Timeout | null = null
  private shownAt = 0
  /** Where the user dragged the popup, if they did. Bottom is kept too, for popups that grow upward. */
  private dragged: { x: number; top: number; bottom: number } | null = null
  private applied: { x: number; y: number } | null = null
  private ghost: BrowserWindow | null = null
  private ghostTimer: NodeJS.Timeout | null = null

  constructor(private handlers: { openAssistant: () => void; openSettings: () => void; onFloatingHidden: () => void }) {}

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

  /**
   * Show the popup next to the cursor. The window stays hidden until the renderer has laid out
   * the new content and reported its size, so the old answer never flashes on screen.
   */
  showFloating(payload: PanelPayload, cursor: { x: number; y: number }, display: DisplayRect): void {
    const win = this.floating
    if (!win || win.isDestroyed()) return
    this.hideGhost()
    this.current = payload
    this.anchor = { x: cursor.x, y: cursor.y, display }
    this.dragged = null
    if (win.isVisible()) win.hide()
    this.size = { width: POPUP_START.width, height: POPUP_START.height }
    this.applyBounds(win)
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send(Ipc.panelOpen, payload)
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
    if (this.revealTimer) clearTimeout(this.revealTimer)
    this.revealTimer = setTimeout(() => this.reveal(), 220)
  }

  /** The renderer reports its content size; the window follows it, anchored at the cursor. */
  resizeFloating(width: number, height: number): void {
    const win = this.floating
    if (!win || win.isDestroyed() || !this.anchor) return
    this.size = {
      width: Math.round(Math.min(Math.max(width, 120), 560)),
      height: Math.round(Math.min(Math.max(height, 40), 720))
    }
    this.applyBounds(win)
    if (this.revealTimer) this.reveal()
  }

  hideFloating(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer)
      this.revealTimer = null
    }
    if (this.floating && !this.floating.isDestroyed() && this.floating.isVisible()) this.floating.hide()
    this.handlers.onFloatingHidden()
  }

  private reveal(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer)
    this.revealTimer = null
    const win = this.floating
    if (!win || win.isDestroyed()) return
    this.shownAt = Date.now()
    win.show()
    win.focus()
  }

  private applyBounds(win: BrowserWindow): void {
    if (!this.anchor) return
    const placement = this.current?.placement ?? 'below'
    let position: { x: number; y: number }
    if (this.dragged) {
      // Keep the spot the user chose; grow down (or up) from it and stay on that display.
      const wanted = { x: this.dragged.x, y: placement === 'above' ? this.dragged.bottom - this.size.height : this.dragged.top }
      const area = screen.getDisplayNearestPoint(wanted).workArea
      position = {
        x: Math.round(Math.min(Math.max(wanted.x, area.x), area.x + area.width - this.size.width)),
        y: Math.round(Math.min(Math.max(wanted.y, area.y), area.y + area.height - this.size.height))
      }
    } else {
      position = placePopup({
        cursorX: this.anchor.x,
        cursorY: this.anchor.y,
        width: this.size.width,
        height: this.size.height,
        display: this.anchor.display,
        placement
      })
    }
    this.applied = position
    win.setBounds({ ...position, ...this.size }, false)
  }

  /**
   * Draw on the ghost overlay that covers one display. `build` receives the overlay's real origin,
   * because macOS may nudge a window (for example below the menu bar); coordinates are made local to it.
   */
  showGhost(bounds: Rect, build: (origin: { x: number; y: number }) => GhostPayload, hideAfterMs: number): void {
    const win = this.ghostWindow()
    if (this.ghostTimer) clearTimeout(this.ghostTimer)
    win.setBounds(bounds, false)
    const actual = win.getBounds()
    const payload = build({ x: actual.x, y: actual.y })
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send(Ipc.ghostShow, payload)
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
    if (!win.isVisible()) win.showInactive()
    this.ghostTimer = setTimeout(() => this.hideGhost(), hideAfterMs)
  }

  hideGhost(): void {
    if (this.ghostTimer) clearTimeout(this.ghostTimer)
    this.ghostTimer = null
    if (this.ghost && !this.ghost.isDestroyed() && this.ghost.isVisible()) this.ghost.hide()
  }

  private ghostWindow(): BrowserWindow {
    if (this.ghost && !this.ghost.isDestroyed()) return this.ghost
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      title: 'SmartCursor Ghost',
      webPreferences: this.webPreferences()
    })
    // Clicks pass straight through to the app underneath, so the user can click the highlighted control.
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    if (process.platform === 'darwin') win.setHiddenInMissionControl(true)
    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.hideGhost()
    })
    this.load(win, 'ghost.html')
    this.ghost = win
    return win
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
      width: POPUP_START.width,
      height: POPUP_START.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // The shadow is drawn in CSS: a native shadow on a transparent, resizing window flickers.
      hasShadow: false,
      backgroundColor: '#00000000',
      title: 'SmartCursor',
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      webPreferences: this.webPreferences()
    })
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.hideFloating()
    })
    // The pill is a drag region. A move we did not make ourselves is the user dragging it.
    win.on('move', () => {
      const bounds = win.getBounds()
      if (this.applied && bounds.x === this.applied.x && bounds.y === this.applied.y) return
      this.dragged = { x: bounds.x, top: bounds.y, bottom: bounds.y + bounds.height }
      this.applied = { x: bounds.x, y: bounds.y }
    })
    // Behave like a context menu: clicking anywhere else closes it.
    win.on('blur', () => {
      if (!win.isVisible() || Date.now() - this.shownAt < 250) return
      this.hideFloating()
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

/** Size before the renderer measures itself: roughly the pill toolbar plus its shadow gutter. */
const POPUP_START = { width: 380, height: 72 }

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
