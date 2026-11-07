const ALARM = 'smartcursor-poll'

async function config() {
  const stored = await chrome.storage.local.get(['baseUrl', 'token'])
  if (!stored.baseUrl || !stored.token) return null
  return { baseUrl: String(stored.baseUrl).replace(/\/$/, ''), token: String(stored.token) }
}

async function requestContext(tabId, includePage) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'get-context', includePage: Boolean(includePage) })
  } catch {
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
  if (!tab?.id || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    return { ok: false, error: 'This page cannot be read by the extension.' }
  }
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
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      'X-SmartCursor-Client': 'chrome'
    },
    body: JSON.stringify({ id, ok: Boolean(result.ok), error: result.error, context: result.context })
  })
}

let polling = false

async function poll() {
  if (polling) return
  const cfg = await config()
  if (!cfg) return
  polling = true
  try {
    const response = await fetch(`${cfg.baseUrl}/v1/actions?client=chrome`, {
      headers: { Authorization: `Bearer ${cfg.token}`, 'X-SmartCursor-Client': 'chrome' }
    })
    if (!response.ok) return
    const payload = await response.json()
    if (payload.action?.id) {
      const result = await handleAction(payload.action).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : 'Extension action failed.' }))
      await postResult(cfg, payload.action.id, result)
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } finally {
    polling = false
    setTimeout(() => void poll(), 50)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 })
  void poll()
})
chrome.runtime.onStartup.addListener(() => void poll())
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void poll()
})
chrome.storage.onChanged.addListener(() => void poll())
void poll()
