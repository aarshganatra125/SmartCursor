const code = document.getElementById('code')
const status = document.getElementById('status')

function show(text, tone) {
  status.textContent = text
  status.className = tone || ''
}

/** Accepts "http://127.0.0.1:PORT#TOKEN" (the pairing code) or "http://127.0.0.1:PORT TOKEN". */
function parse(value) {
  const match = value.trim().match(/^(http:\/\/127\.0\.0\.1:\d{2,5})\/?[#\s]+([A-Za-z0-9]{16,128})$/)
  return match ? { baseUrl: match[1], token: match[2] } : null
}

chrome.storage.local.get(['baseUrl', 'token']).then((stored) => {
  if (stored.baseUrl && stored.token) {
    code.value = `${stored.baseUrl}#${stored.token}`
    void check(stored.baseUrl, stored.token)
  }
})

async function check(baseUrl, token) {
  try {
    const response = await fetch(`${baseUrl}/v1/health?client=chrome`, { headers: { Authorization: `Bearer ${token}`, 'X-SmartCursor-Client': 'chrome' } })
    if (response.ok) show('Connected to SmartCursor.', 'ok')
    else if (response.status === 403) show('Connected, but the Chrome integration is turned off in SmartCursor Settings.', 'bad')
    else show('SmartCursor rejected this code. Copy a fresh one from Settings.', 'bad')
  } catch {
    show('Saved, but SmartCursor is not running. Start the desktop app and it will connect on its own.', 'bad')
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const parsed = parse(code.value)
  if (!parsed) {
    show('That does not look like a pairing code. It starts with http://127.0.0.1:', 'bad')
    return
  }
  await chrome.storage.local.set(parsed)
  show('Checking…')
  await check(parsed.baseUrl, parsed.token)
})

code.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('save').click()
})
