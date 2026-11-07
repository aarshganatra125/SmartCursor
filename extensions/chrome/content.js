function readSelection() {
  const element = document.activeElement
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    if (end > start) return element.value.slice(start, end)
  }
  return window.getSelection()?.toString() ?? ''
}

function pageExcerpt() {
  return (document.body?.innerText ?? '').replace(/\s+\n/g, '\n').trim().slice(0, 8000)
}

function insertText(text) {
  const element = document.activeElement
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? start
    element.setRangeText(text, start, end, 'end')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, mode: 'field' }
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    const inserted = document.execCommand('insertText', false, text)
    return inserted ? { ok: true, mode: 'contenteditable' } : { ok: false, error: 'The page blocked text insertion.' }
  }
  return { ok: false, error: 'No editable field is focused on this page.' }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-context') {
    sendResponse({
      selection: readSelection(),
      url: location.href,
      title: document.title,
      pageExcerpt: message.includePage ? pageExcerpt() : ''
    })
    return false
  }
  if (message?.type === 'insert-text') {
    sendResponse(insertText(String(message.text ?? '')))
    return false
  }
  return false
})
