# SmartCursor

SmartCursor is a background desktop assistant. It opens over the application you are already using, reads the context you approve, asks the configured Gemini model for help, and can put an approved result back.

It is an Electron app. It does not replace Chrome, VS Code, Terminal, or your documents.

## Run

```bash
npm install
npm run dev
```

The menu-bar icon opens the assistant. The default shortcut is **⌘⇧Space** on macOS and **Ctrl+Shift+Space** on Windows (`CommandOrControl+Shift+Space`).

Add a Gemini API key in Settings. It is encrypted with the operating system keychain (`safeStorage`) and is not written to SQLite.

## Permissions on macOS

Selection and paste use `native/macos/SmartCursorBridge`.

1. System Settings → Privacy & Security → Accessibility → enable `SmartCursorBridge`. In development its path is inside this repository at `native/macos/SmartCursorBridge`. Settings shows the exact path.
2. Screen Recording is required only after you click **Capture window** or **Capture screen**. In development, grant it to **Electron**. A packaged app would request it for SmartCursor.
3. The first time the API key is saved, macOS may ask to use the keychain.

SmartCursor does not capture the screen in the background. OCR on macOS uses the on-device Vision framework. The temporary image is deleted after recognition and is not stored.

If Accessibility is denied, the assistant still opens. Copy remains available. Clipboard fallback, when enabled, sends a temporary Copy and then restores the previous clipboard. Some apps, including Google Docs, do not expose a selection to Accessibility or to Chrome; use Capture for those.

## Extensions

Both extensions talk only to `127.0.0.1` and must present the pairing token.

- Chrome: load `extensions/chrome` as an unpacked extension. Paste the address and token from Settings → Integrations.
- VS Code: the extension in `extensions/vscode` reads `~/Library/Application Support/SmartCursor/bridge.json`. Copy that folder into your VS Code extensions directory and reload the window. Its status bar says `connected` only after the desktop app answers.

Connection status in Settings is based on real requests. If an extension is not installed, it stays “Not connected.”

## Limits

- Terminals can be explained, but SmartCursor will not paste into them or run commands.
- Email replies are drafts. Nothing is sent.
- Direct editing works through the VS Code API or the Chrome content script when that extension is connected. Otherwise an approved paste is used, and Copy is the fallback.
- Windows uses PowerShell for the active window, a temporary Ctrl+C for selection, and Tesseract for OCR. Those paths are implemented, and this machine was verified on macOS.
