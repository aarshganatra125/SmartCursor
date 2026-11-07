const vscode = require('vscode')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

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

function request(method, pathname, bridge, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: bridge.port,
      path: pathname,
      method,
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-SmartCursor-Client': 'vscode'
      },
      timeout: 25000
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
}

function editorContext() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return { selection: '', fileName: '', languageId: '', surrounding: '', diagnostics: [] }
  const document = editor.document
  const start = Math.max(0, editor.selection.start.line - 40)
  const end = Math.min(document.lineCount - 1, editor.selection.end.line + 40)
  const diagnostics = vscode.languages.getDiagnostics(document.uri).slice(0, 20).map((item) => ({
    message: item.message,
    severity: item.severity === 0 ? 'error' : item.severity === 1 ? 'warning' : 'info',
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
  if (!editor) return { ok: false, error: 'No editor is active.' }
  const applied = await editor.edit((builder) => {
    if (editor.selection.isEmpty) builder.insert(editor.selection.active, text)
    else builder.replace(editor.selection, text)
  })
  return applied ? { ok: true } : { ok: false, error: 'VS Code rejected the edit.' }
}

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50)
  item.text = 'SmartCursor: offline'
  item.show()
  let stopped = false
  let lastText = ''

  context.subscriptions.push(item, { dispose: () => { stopped = true } })
  context.subscriptions.push(vscode.commands.registerCommand('smartcursor.applyLast', async () => {
    if (!lastText) {
      vscode.window.showInformationMessage('SmartCursor has no approved edit waiting.')
      return
    }
    const result = await applyEdit(lastText)
    if (!result.ok) vscode.window.showWarningMessage(result.error || 'Could not apply the edit.')
  }))

  const loop = async () => {
    while (!stopped) {
      const bridge = loadBridge()
      if (!bridge) {
        item.text = 'SmartCursor: desktop app not found'
        await delay(2000)
        continue
      }
      try {
        const response = await request('GET', '/v1/actions?client=vscode', bridge)
        if (response.status === 200) item.text = 'SmartCursor: connected'
        else item.text = 'SmartCursor: rejected'
        const action = response.body.action
        if (!action?.id) continue
        let result
        if (action.type === 'request-context') result = { ok: true, context: editorContext() }
        else if (action.type === 'apply-edit') {
          lastText = String(action.text ?? '')
          result = await applyEdit(lastText)
          if (result.ok) void vscode.window.showInformationMessage('SmartCursor applied an approved edit.')
        } else result = { ok: false, error: 'Unsupported action.' }
        await request('POST', '/v1/result?client=vscode', bridge, { id: action.id, ...result })
      } catch {
        item.text = 'SmartCursor: offline'
        await delay(2000)
      }
    }
  }
  void loop()
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deactivate() {}

module.exports = { activate, deactivate }
