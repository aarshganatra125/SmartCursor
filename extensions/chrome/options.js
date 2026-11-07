const baseUrl = document.getElementById('baseUrl')
const token = document.getElementById('token')
const status = document.getElementById('status')

chrome.storage.local.get(['baseUrl', 'token']).then((stored) => {
  baseUrl.value = stored.baseUrl || ''
  token.value = stored.token || ''
})

document.getElementById('save').addEventListener('click', async () => {
  const url = baseUrl.value.trim().replace(/\/$/, '')
  const secret = token.value.trim()
  if (!url.startsWith('http://127.0.0.1:')) {
    status.textContent = 'The address must start with http://127.0.0.1:'
    return
  }
  await chrome.storage.local.set({ baseUrl: url, token: secret })
  try {
    const response = await fetch(`${url}/v1/health?client=chrome`, { headers: { Authorization: `Bearer ${secret}`, 'X-SmartCursor-Client': 'chrome' } })
    status.textContent = response.ok ? 'Connected to SmartCursor.' : 'SmartCursor rejected the token.'
  } catch {
    status.textContent = 'Saved, but SmartCursor is not reachable. Start the desktop app and try again.'
  }
})
