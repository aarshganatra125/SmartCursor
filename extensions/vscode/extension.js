const vscode = require('vscode')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

// Each VS Code window runs its own copy of this extension. The id and last-focus time let the
// desktop app send requests to the window you were actually using.
const INSTANCE = crypto.randomBytes(8).toString('hex')

function bridgePath() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'SmartCursor', 'bridge.json')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'SmartCursor', 'bridge.json')
  return path.join(os.homedir(), '.config', 'SmartCursor', 'bridge.json')
}

function loadBridge() {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), 'utf8'))
    if (!parsed || typeof parsed.port !== 'number' || typeof parsed.token !== 'string') return null
    return { port: parsed.port, token: parsed.token }
  } catch {
    return null
  }
}

let focusedAt = 0

/** Returns { promise, cancel } so a long-poll can be dropped when this window regains focus. */
function request(method, pathname, bridge, body, timeout = 25000) {
  let req
  const promise = new Promise((resolve, reject) => {
    req = http.request({
      hostname: '127.0.0.1',
      port: bridge.port,
      path: pathname,
      method,
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-SmartCursor-Client': 'vscode',
        'X-SmartCursor-Instance': INSTANCE,
        'X-SmartCursor-Focused-At': String(focusedAt)
      },
      timeout
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') })
        } catch {
          reject(new Error('Unreadable response from SmartCursor.'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
  return { promise, cancel: () => req?.destroy(new Error('cancelled')) }
}

function editorContext() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return { selection: '', fileName: '', languageId: '', surrounding: '', diagnostics: [] }
  const document = editor.document
  const start = Math.max(0, editor.selection.start.line - 40)
  const end = Math.min(document.lineCount - 1, editor.selection.end.line + 40)
  const diagnostics = vscode.languages.getDiagnostics(document.uri)
    .filter((item) => item.severity <= vscode.DiagnosticSeverity.Warning)
    .slice(0, 20)
    .map((item) => ({
      message: item.message,
      severity: item.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
      line: item.range.start.line + 1
    }))
  return {
    selection: document.getText(editor.selection),
    fileName: path.basename(document.fileName),
    languageId: document.languageId,
    surrounding: document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length)),
    diagnostics
  }
}

async function applyEdit(text) {
  const editor = vscode.window.activeTextEditor
  if (!editor) return { ok: false, error: 'No editor is active in VS Code.' }
  const applied = await editor.edit((builder) => {
    if (editor.selection.isEmpty) builder.insert(editor.selection.active, text)
    else builder.replace(editor.selection, text)
  })
  return applied ? { ok: true } : { ok: false, error: 'VS Code rejected the edit.' }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  item.command = 'smartcursor.open'
  item.show()
  let stopped = false
  let lastText = ''
  let current = null

  const setStatus = (state, detail) => {
    const icon = state === 'connected' ? '$(sparkle)' : state === 'connecting' ? '$(sync~spin)' : '$(circle-slash)'
    item.text = `${icon} SmartCursor`
    item.tooltip = `${detail}\nClick to ask SmartCursor about the selection.`
  }
  setStatus('connecting', 'Looking for the SmartCursor desktop app…')

  focusedAt = vscode.window.state.focused ? Date.now() : 0
  context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
    if (!state.focused) return
    focusedAt = Date.now()
    // Re-poll right away so the desktop app learns this window is now the one in use.
    current?.cancel()
  }))

  context.subscriptions.push(item, { dispose: () => { stopped = true; current?.cancel() } })

  context.subscriptions.push(vscode.commands.registerCommand('smartcursor.open', async () => {
    const bridge = loadBridge()
    if (!bridge) {
      void vscode.window.showWarningMessage('SmartCursor is not running. Start the desktop app first.')
      return
    }
    focusedAt = Date.now()
    try {
      const response = await request('POST', '/v1/open?client=vscode', bridge, { context: editorContext() }, 4000).promise
      if (response.status === 401) void vscode.window.showWarningMessage('SmartCursor rejected this window. Restart VS Code after rotating the token.')
      else if (response.status === 403) void vscode.window.showWarningMessage('The VS Code integration is turned off in SmartCursor Settings.')
      else if (response.status !== 200) void vscode.window.showWarningMessage('SmartCursor could not open.')
    } catch {
      void vscode.window.showWarningMessage('SmartCursor is not reachable. Is the desktop app running?')
    }
  }))

  context.subscriptions.push(vscode.commands.registerCommand('smartcursor.applyLast', async () => {
    if (!lastText) {
      void vscode.window.showInformationMessage('SmartCursor has no approved edit waiting.')
      return
    }
    const result = await applyEdit(lastText)
    if (!result.ok) void vscode.window.showWarningMessage(result.error || 'Could not apply the edit.')
  }))

  const loop = async () => {
    let failures = 0
    while (!stopped) {
      const bridge = loadBridge()
      if (!bridge) {
        setStatus('offline', 'The SmartCursor desktop app is not running.')
        await delay(3000)
        continue
      }
      try {
        current = request('GET', '/v1/actions?client=vscode', bridge)
        const response = await current.promise
        current = null
        if (response.status === 401) {
          // Usually the token was rotated; bridge.json is re-read on the next attempt.
          setStatus('offline', 'SmartCursor rejected the pairing token. Retrying…')
          await delay(5000)
          continue
        }
        if (response.status === 403) {
          setStatus('offline', 'The VS Code integration is turned off in SmartCursor Settings.')
          await delay(10000)
          continue
        }
        if (response.status !== 200) {
          setStatus('offline', `SmartCursor answered with ${response.status}.`)
          await delay(3000)
          continue
        }
        failures = 0
        setStatus('connected', 'Connected to SmartCursor.')
        const action = response.body.action
        if (!action?.id) continue
        let result
        if (action.type === 'request-context') result = { ok: true, context: editorContext() }
        else if (action.type === 'apply-edit') {
          lastText = String(action.text ?? '')
          result = await applyEdit(lastText)
        } else result = { ok: false, error: 'Unsupported action.' }
        await request('POST', '/v1/result?client=vscode', bridge, { id: action.id, ...result }, 5000).promise
      } catch (error) {
        current = null
        if (error instanceof Error && error.message === 'cancelled') continue
        failures += 1
        setStatus('offline', 'SmartCursor is not reachable.')
        await delay(Math.min(1000 * 2 ** Math.min(failures, 3), 8000))
      }
    }
  }
  void loop()
}

function deactivate() {}

module.exports = { activate, deactivate }
