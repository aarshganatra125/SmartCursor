const ALARM = 'smartcursor-poll'
const MENU = 'smartcursor-ask'

async function config() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token'])
  if (!stored.baseUrl || !stored.token) return null
  return { baseUrl: String(stored.baseUrl).replace(/\/$/, ''), token: String(stored.token) }
}

function headers(cfg) {
  return { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', 'X-SmartCursor-Client': 'chrome' }
}

function readableTab(tab) {
  return Boolean(tab?.id) && !/^(chrome|chrome-extension|edge|about|devtools|view-source):/.test(tab.url ?? '')
}

async function requestContext(tabId, includePage) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'get-context', includePage: Boolean(includePage) })
  } catch {
    // Tabs opened before the extension was installed or reloaded have no content script yet.
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (include) => {
        const element = document.activeElement
        let selection = ''
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const start = element.selectionStart ?? 0
          const end = element.selectionEnd ?? 0
          if (end > start) selection = element.value.slice(start, end)
        }
        if (!selection) selection = window.getSelection()?.toString() ?? ''
        return {
          selection,
          url: location.href,
          title: document.title,
          pageExcerpt: include ? (document.body?.innerText ?? '').trim().slice(0, 8000) : ''
        }
      },
      args: [Boolean(includePage)]
    })
    return injected?.result ?? null
  }
}

async function insertIntoTab(tabId, text) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'insert-text', text })
  } catch {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (value) => {
        const element = document.activeElement
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const start = element.selectionStart ?? element.value.length
          const end = element.selectionEnd ?? start
          element.setRangeText(value, start, end, 'end')
          element.dispatchEvent(new Event('input', { bubbles: true }))
          return { ok: true }
        }
        if (element instanceof HTMLElement && element.isContentEditable && document.execCommand('insertText', false, value)) {
          return { ok: true }
        }
        return { ok: false, error: 'No editable field is focused on this page.' }
      },
      args: [text]
    })
    return injected?.result ?? { ok: false, error: 'The page could not be edited.' }
  }
}

async function handleAction(action) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!readableTab(tab)) return { ok: false, error: 'This page cannot be read by the extension.' }
  if (action.type === 'request-context') {
    const context = await requestContext(tab.id, action.includePage)
    if (!context) return { ok: false, error: 'No page context was available.' }
    return { ok: true, context }
  }
  if (action.type === 'insert-text') {
    const result = await insertIntoTab(tab.id, action.text)
    return { ok: Boolean(result?.ok), error: result?.error, context: { selection: '' } }
  }
  return { ok: false, error: 'Unsupported action.' }
}

async function postResult(cfg, id, result) {
  await fetch(`${cfg.baseUrl}/v1/result?client=chrome`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ id, ok: Boolean(result.ok), error: result.error, context: result.context })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let polling = false
let failures = 0

/** Long-poll the desktop app for work. Backs off when it is down or rejects the token. */
async function poll() {
  if (polling) return
  const cfg = await config()
  if (!cfg) return
  polling = true
  let wait = 0
  try {
    const response = await fetch(`${cfg.baseUrl}/v1/actions?client=chrome`, { headers: headers(cfg) })
    if (response.status === 401 || response.status === 403) {
      // Wrong token or the integration is switched off. Waiting avoids hammering the app.
      wait = 15000
      return
    }
    if (!response.ok) {
      wait = 3000
      return
    }
    failures = 0
    const payload = await response.json()
    if (payload.action?.id) {
      const result = await handleAction(payload.action).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : 'Extension action failed.' }))
      await postResult(cfg, payload.action.id, result)
    }
  } catch {
    failures += 1
    wait = Math.min(1000 * 2 ** Math.min(failures, 4), 15000)
  } finally {
    polling = false
    setTimeout(() => void poll(), wait || 30)
  }
}

/** Right-click → "Ask SmartCursor": send what is selected and open the popup at the pointer. */
async function askFromMenu(info, tab) {
  const cfg = await config()
  if (!cfg) {
    await chrome.runtime.openOptionsPage()
    return
  }
  let context = { selection: info.selectionText ?? '', url: tab?.url ?? '', title: tab?.title ?? '' }
  if (readableTab(tab)) {
    const read = await requestContext(tab.id, false).catch(() => null)
    if (read && (read.selection || !context.selection)) context = { ...context, ...read }
  }
  await fetch(`${cfg.baseUrl}/v1/open?client=chrome`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ context })
  }).catch(() => undefined)
}

function setup() {
  // 30 seconds is the shortest alarm Chrome allows; it revives the worker if Chrome stopped it.
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 })
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU, title: 'Ask SmartCursor', contexts: ['selection', 'editable', 'page', 'link', 'image'] })
  })
  void poll()
}

chrome.runtime.onInstalled.addListener(setup)
chrome.runtime.onStartup.addListener(setup)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void poll()
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) void askFromMenu(info, tab)
})
chrome.storage.onChanged.addListener(() => {
  failures = 0
  void poll()
})
void poll()
