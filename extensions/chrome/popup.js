const status = document.getElementById('status')
chrome.storage.local.get(['baseUrl', 'token']).then(async (stored) => {
  if (!stored.baseUrl || !stored.token) {
    status.textContent = 'Not paired. Open Pairing options and paste the pairing code from SmartCursor Settings.'
    return
  }
  try {
    const response = await fetch(`${stored.baseUrl}/v1/health?client=chrome`, {
      headers: { Authorization: `Bearer ${stored.token}`, 'X-SmartCursor-Client': 'chrome' }
    })
    status.textContent = response.ok ? 'Connected to the desktop app.' : 'The desktop app rejected the pairing token.'
  } catch {
    status.textContent = 'Desktop app is not running.'
  }
})
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage())
