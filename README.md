# SmartCursor

SmartCursor is a background desktop assistant. It opens over the application you are already using, reads the context you approve, asks the configured Gemini model for help, and can put an approved result back.

It is an Electron app. It does not replace Chrome, VS Code, Terminal, or your documents.

## Run

```bash
npm install
npm run dev
```

The menu-bar icon opens the assistant. The default shortcut is **⌘⇧Space** on macOS and **Ctrl+Shift+Space** on Windows (`CommandOrControl+Shift+Space`).

The assistant is a small toolbar that opens at the pointer, like a right-click menu. The lead action depends on the app (Explain in editors and browsers, Reply in mail, Polish in documents). Press **Enter** for it, **1–5** for the others, or just start typing to ask a question. On macOS you can also hold **Shift and right-click** (or Shift + two-finger click) anywhere to open it at that spot; that click is not passed to the app underneath. Turn this off in Settings → General. Clicking anywhere else closes it.

The mic beside the prompt records only after you click it. Click again to stop; SmartCursor sends that short clip to Gemini for transcription, puts the text in the prompt, and discards the audio. It never submits the spoken prompt automatically.

**Show me where** (the target button, or press `?`): ask “where do I export as PDF?” and a ghost pointer glides to that control on the screen you are on and circles it. It captures that one display (Screen Recording permission), asks Gemini where the control is, and never clicks for you.

**Do it / Allow all**: in the same box, switch from *Show me* to *Do it* (approve each step) or *Allow all* (SmartCursor clicks, types and opens things itself) — e.g. “find my Resume folder and open it” or “insert a table”. Guardrails are enforced in code, not left to the AI: it never operates terminals, Disk Utility, Keychain Access or SmartCursor itself; never uses delete/force-quit/log-out shortcuts; never types into password fields or types card numbers; only opens documents and folders inside your home folder (never programs, installers or Library); and always asks before anything that deletes, sends, submits, pays, installs or grants permission — even in Allow all. At most 12 steps or 2 minutes; **Esc** or the SmartCursor shortcut stops it.

Free-form questions (**Ask**) may use Google Search, so “what's the Man City score?” gets a live answer with source links. Gemini 3 models include 5,000 searches a month free; after that Google bills per search. **⋯** shows the context that will be sent and lets you read the window or screen.

`npm install` downloads the Electron binary and builds the macOS helper. `npm run dev` works even when launched from a VS Code task (it clears `ELECTRON_RUN_AS_NODE`).

Add a Gemini API key in Settings. It is encrypted with the operating system keychain (`safeStorage`) and is not written to SQLite.

## Permissions on macOS

Selection and paste use `native/macos/SmartCursorBridge`.

1. System Settings → Privacy & Security → Accessibility → enable `SmartCursorBridge`. This also powers Shift + right-click. Rebuilding the helper (`npm install` or `npm run build:native`) changes its signature, so remove it from the list and add it again afterwards. In development its path is inside this repository at `native/macos/SmartCursorBridge`. Settings shows the exact path.
2. Screen Recording is required only after you click **Capture window** or **Capture screen**. In development, grant it to **Electron**. A packaged app would request it for SmartCursor.
3. The first time the API key is saved, macOS may ask to use the keychain.

SmartCursor does not capture the screen in the background. OCR on macOS uses the on-device Vision framework. The temporary image is deleted after recognition and is not stored.

If Accessibility is denied, the assistant still opens. Copy remains available. Clipboard fallback, when enabled, sends a temporary Copy and then restores the previous clipboard. Some apps, including Google Docs, do not expose a selection to Accessibility or to Chrome; use Capture for those.

## Extensions

Both extensions talk only to `127.0.0.1` and must present the pairing token.

- Chrome: load `extensions/chrome` as an unpacked extension. In SmartCursor, open Settings → Integrations → **Copy pairing code** and paste it into the extension options. Then right-click a selection and choose **Ask SmartCursor**.
- VS Code: the extension in `extensions/vscode` reads `~/Library/Application Support/SmartCursor/bridge.json`, so it pairs on its own. Copy that folder into your VS Code extensions directory and reload the window. Right-click in the editor → **Ask SmartCursor**, or click SmartCursor in the status bar. With several VS Code windows open, requests go to the one you used last.

Connection status in Settings is based on real requests. If an extension is not installed, it stays “Not connected.”

## Limits

- Terminals can be explained, but SmartCursor will not paste into them or run commands.
- Email replies are drafts. Nothing is sent.
- Direct editing works through the VS Code API or the Chrome content script when that extension is connected. Otherwise an approved paste is used, and Copy is the fallback.
- Windows uses PowerShell for the active window, a temporary Ctrl+C for selection, and Tesseract for OCR. Those paths are implemented, and this machine was verified on macOS.
