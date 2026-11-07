import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Bootstrap, HistoryItem, IntegrationSnapshot, PermissionSnapshot, SettingsData } from '@shared/types'
import { MODEL_PRESETS } from '@shared/types'

type SectionId = 'general' | 'ai' | 'permissions' | 'integrations' | 'privacy' | 'history'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'history', label: 'History' }
]

export function SettingsApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [data, setData] = useState<Bootstrap | null>(null)
  const [section, setSection] = useState<SectionId>('general')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])

  async function refresh() {
    const result = await window.smartcursor.bootstrap()
    if (!result.ok || !result.bootstrap) {
      setError(result.error || 'Could not load settings.')
      return
    }
    setData(result.bootstrap)
    setTheme(result.bootstrap.resolvedTheme)
    setError(null)
  }

  useEffect(() => {
    if (!window.smartcursor) return
    void refresh()
    const stopTheme = window.smartcursor.onTheme((next) => setTheme(next))
    const stopIntegrations = window.smartcursor.onIntegrations((integrations) => {
      setData((current) => current ? { ...current, integrations } : current)
    })
    return () => {
      stopTheme()
      stopIntegrations()
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.body.style.background = theme === 'dark' ? '#18181b' : '#f4f4f5'
  }, [theme])

  useEffect(() => {
    if (section === 'history' && window.smartcursor) {
      void window.smartcursor.history().then(setHistory)
    }
  }, [section])

  if (!window.smartcursor) return <p className="p-8">Preload unavailable.</p>
  if (!data) return <p className="p-8 text-sm text-zinc-500">{error || 'Loading settings…'}</p>

  return (
    <div className="flex h-full bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-50">
      <aside className="flex w-52 shrink-0 flex-col border-r border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-zinc-950/70">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-zinc-900 text-[13px] text-amber-300 dark:bg-white dark:text-zinc-900">✦</div>
          <div>
            <p className="text-sm font-semibold">SmartCursor</p>
            <p className="text-[11px] text-zinc-500">Desktop assistant</p>
          </div>
        </div>
        {SECTIONS.map((item) => (
          <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`mb-1 rounded-xl px-3 py-2 text-left text-[13px] ${section === item.id ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10'}`}>
            {item.label}
          </button>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-8">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {section === 'general' && <General data={data} onChange={refresh} onError={setError} />}
        {section === 'ai' && <Ai data={data} onChange={refresh} onError={setError} />}
        {section === 'permissions' && <Permissions permissions={data.permissions} onChange={refresh} />}
        {section === 'integrations' && <Integrations data={data} onChange={refresh} onError={setError} />}
        {section === 'privacy' && <Privacy data={data} onChange={refresh} onError={setError} />}
        {section === 'history' && <History items={history} onChange={async () => setHistory(await window.smartcursor.history())} />}
      </main>
    </div>
  )
}

function General({ data, onChange, onError }: { data: Bootstrap; onChange: () => Promise<void>; onError: (value: string | null) => void }) {
  const [shortcut, setShortcut] = useState(data.settings.shortcut)
  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">General</h2>
      <Field label="Theme">
        <select value={data.settings.theme} onChange={(event) => void save({ theme: event.target.value as SettingsData['theme'] }, onChange, onError)} className={selectClass}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>
      <Field label="Global shortcut">
        <input value={shortcut} onChange={(event) => setShortcut(event.target.value)} onKeyDown={(event) => recordShortcut(event, setShortcut)} className={inputClass} />
        <p className="mt-1 text-[12px] text-zinc-500">macOS default is CommandOrControl+Shift+Space, which is ⌘⇧Space here and Ctrl+Shift+Space on Windows. Click the field and press a combination, then save.</p>
        <p className="mt-1 text-[12px]">{data.shortcutRegistered ? 'Shortcut is registered.' : data.shortcutError || 'Shortcut is not registered.'}</p>
        <button type="button" className={buttonClass} onClick={() => void saveShortcut(shortcut, onChange, onError)}>Save shortcut</button>
      </Field>
      <div className="space-y-1">
        <Check label="Toolbar follows the pointer" checked={data.settings.followPointer} onChange={(value) => void save({ followPointer: value }, onChange, onError)} />
        <p className="pl-6 text-[12px] text-zinc-500">After it opens, the toolbar glides along with your pointer. It stops as soon as you move toward it, and stays put once you click, type or drag it.</p>
      </div>
      {data.mouseTrigger.supported && (
        <div className="space-y-1">
          <Check label="Open with Shift + right-click anywhere" checked={data.settings.mouseTrigger} onChange={(value) => void save({ mouseTrigger: value }, onChange, onError)} />
          <p className="pl-6 text-[12px] text-zinc-500">Hold Shift and right-click (or Shift + two-finger click) to open SmartCursor at the pointer. That click does not reach the app underneath.</p>
          {data.settings.mouseTrigger && (
            <p className={`pl-6 text-[12px] ${data.mouseTrigger.running ? 'text-emerald-600' : 'text-amber-700 dark:text-amber-300'}`}>
              {data.mouseTrigger.running ? 'Active.' : data.mouseTrigger.error || 'Starting…'}
              {!data.mouseTrigger.running && data.mouseTrigger.error?.includes('Accessibility') && ' Allow it in Permissions, then come back here.'}
            </p>
          )}
        </div>
      )}
      <p className="text-[12px] text-zinc-500">Local store: {data.storage === 'sqlite' ? 'SQLite' : 'JSON fallback'}. Platform: {data.platform}.</p>
    </div>
  )
}

function Ai({ data, onChange, onError }: { data: Bootstrap; onChange: () => Promise<void>; onError: (value: string | null) => void }) {
  const [key, setKey] = useState('')
  const [oddsKey, setOddsKey] = useState('')
  const [model, setModel] = useState(data.settings.model)
  const [baseUrl, setBaseUrl] = useState(data.settings.baseUrl)
  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">AI</h2>
      <Field label="Gemini API key">
        <p className="mb-2 text-[12px] text-zinc-500">{data.hasApiKey ? `Saved in the system keychain (${data.apiKeyHint}).` : 'No key saved. The key never goes into the renderer after you save it.'}</p>
        <input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="AIza…" className={inputClass} />
        <div className="mt-2 flex gap-2">
          <button type="button" className={buttonClass} onClick={() => void saveKey(key, setKey, onChange, onError)}>Save key</button>
          <button type="button" className={quietButton} onClick={() => void clearKey(onChange, onError)}>Remove key</button>
        </div>
      </Field>
      <Field label="The Odds API key (live scores)">
        <p className="mb-2 text-[12px] text-zinc-500">{data.hasOddsApiKey ? `Saved in the system keychain (${data.oddsApiKeyHint}). Live-score questions use The Odds API directly, without Gemini Search.` : 'No key saved. Add a free The Odds API key to enable live scores.'}</p>
        <input type="password" value={oddsKey} onChange={(event) => setOddsKey(event.target.value)} placeholder="Odds API key" className={inputClass} />
        <div className="mt-2 flex gap-2">
          <button type="button" className={buttonClass} onClick={() => void saveOddsKey(oddsKey, setOddsKey, onChange, onError)}>Save key</button>
          <button type="button" className={quietButton} onClick={() => void clearOddsKey(onChange, onError)}>Remove key</button>
        </div>
      </Field>
      <Field label="Model">
        <select value={MODEL_PRESETS.includes(model) ? model : 'custom'} onChange={(event) => setModel(event.target.value === 'custom' ? '' : event.target.value)} className={selectClass}>
          {MODEL_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          <option value="custom">Custom model id</option>
        </select>
        <input value={model} onChange={(event) => setModel(event.target.value)} className={`${inputClass} mt-2`} />
      </Field>
      <Field label="API base URL">
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Leave blank for the Gemini API" className={inputClass} />
      </Field>
      <button type="button" className={buttonClass} onClick={() => void save({ model, baseUrl }, onChange, onError)}>Save model</button>
    </div>
  )
}

function Permissions({ permissions, onChange }: { permissions: PermissionSnapshot; onChange: () => Promise<void> }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Permissions</h2>
      <Status label="Accessibility" value={permissions.accessibility} />
      <Status label="Screen recording" value={permissions.screenRecording} />
      <p className="text-[13px] text-zinc-600 dark:text-zinc-300">Helper: {permissions.helperInstalled ? permissions.helperPath : 'not built'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => void window.smartcursor.promptAccessibility().then(() => onChange())}>Prompt for accessibility</button>
        <button type="button" className={quietButton} onClick={() => void window.smartcursor.openPermission('accessibility')}>Open Accessibility settings</button>
        <button type="button" className={quietButton} onClick={() => void window.smartcursor.openPermission('screen')}>Open Screen Recording settings</button>
        <button type="button" className={quietButton} onClick={() => void onChange()}>Refresh</button>
      </div>
      <ul className="space-y-2 text-[13px] leading-5 text-zinc-600 dark:text-zinc-300">
        {permissions.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <div className="rounded-2xl bg-white p-4 text-[13px] leading-5 dark:bg-zinc-950">
        <p className="font-medium">What to allow on macOS</p>
        <p className="mt-2">Accessibility for the SmartCursorBridge helper lets SmartCursor read selected text and paste an approved result. In development, Screen Recording must be allowed for Electron, because capture runs in the Electron process. Packaged builds ask for SmartCursor instead. SmartCursor never captures the screen until you click Capture.</p>
      </div>
    </div>
  )
}

function Integrations({ data, onChange, onError }: { data: Bootstrap; onChange: () => Promise<void>; onError: (value: string | null) => void }) {
  const integrations = data.integrations
  return (
    <div className="max-w-2xl space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">Integrations</h2>
      <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-300">Status is live. An extension is connected only after it reaches the local server. Nothing here is simulated.</p>
      <Connection name="Chrome" status={integrations.chrome} />
      <Connection name="VS Code" status={integrations.vscode} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.integrations.chrome} onChange={(event) => void save({ integrations: { ...data.settings.integrations, chrome: event.target.checked } }, onChange, onError)} /> Enable Chrome extension</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.settings.integrations.vscode} onChange={(event) => void save({ integrations: { ...data.settings.integrations, vscode: event.target.checked } }, onChange, onError)} /> Enable VS Code extension</label>
      <div className="rounded-2xl bg-white p-4 text-[12.5px] leading-5 dark:bg-zinc-950">
        <p>Local address: http://127.0.0.1:{integrations.port ?? '—'}</p>
        <p className="mt-1 break-all">Pairing token: {integrations.token}</p>
        <p className="mt-1 break-all">Bridge file for VS Code: {integrations.bridgePath}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={quietButton} disabled={!integrations.port || !integrations.token} onClick={() => void window.smartcursor.copyText(`http://127.0.0.1:${integrations.port ?? ''}#${integrations.token ?? ''}`)}>Copy pairing code</button>
          <button type="button" className={quietButton} onClick={() => void rotate(onChange, onError)}>Rotate token</button>
        </div>
      </div>
      <div className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-300">
        <p>Chrome: open chrome://extensions, enable Developer mode, and load the `extensions/chrome` folder. Click Copy pairing code above and paste it into the extension options. Then right-click any selection and choose Ask SmartCursor.</p>
        <p className="mt-2">VS Code: copy `extensions/vscode` into your extensions folder and reload VS Code. It pairs on its own using the bridge file. Right-click in the editor and choose Ask SmartCursor, or click SmartCursor in the status bar.</p>
      </div>
    </div>
  )
}

function Privacy({ data, onChange, onError }: { data: Bootstrap; onChange: () => Promise<void>; onError: (value: string | null) => void }) {
  const privacy = data.settings.privacy
  const update = (patch: Partial<SettingsData['privacy']>) => void save({ privacy: { ...privacy, ...patch } }, onChange, onError)
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Privacy</h2>
      <Check label="Store conversation history locally" checked={privacy.storeHistory} onChange={(value) => update({ storeHistory: value })} />
      <Check label="Allow a temporary Copy when accessibility cannot read the selection" checked={privacy.allowClipboardFallback} onChange={(value) => update({ allowClipboardFallback: value })} />
      <Check label="Allow screenshot capture and OCR after I click Capture" checked={privacy.allowScreenshotOcr} onChange={(value) => update({ allowScreenshotOcr: value })} />
      <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-300">Selected text is shown in the panel before any model request. Screenshots are deleted after OCR and are not written to the database. Voice input records only after you click the mic, sends one short clip to Gemini for transcription, then discards the audio. API keys stay in the operating system keychain. SmartCursor does not send email, submit forms, or run terminal commands.</p>
    </div>
  )
}

function History({ items, onChange }: { items: HistoryItem[]; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">History</h2>
        <button type="button" className={quietButton} onClick={() => void window.smartcursor.deleteHistory().then(onChange)}>Delete all</button>
      </div>
      {items.length === 0 && <p className="text-sm text-zinc-500">No stored conversations. Turn history off in Privacy if you do not want new ones saved.</p>}
      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-2xl bg-white p-4 dark:bg-zinc-950">
            <button type="button" className="w-full text-left" onClick={() => setOpen(open === item.id ? null : item.id)}>
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-[12px] text-zinc-500">{item.appName} · {new Date(item.createdAt).toLocaleString()}</p>
            </button>
            {open === item.id && (
              <div className="mt-3 space-y-2">
                {item.messages.map((message, index) => (
                  <p key={`${item.id}-${index}`} className="whitespace-pre-wrap text-[12.5px] leading-5"><span className="font-medium">{message.role}: </span>{message.content}</p>
                ))}
                <button type="button" className={quietButton} onClick={() => void window.smartcursor.deleteHistory(item.id).then(onChange)}>Delete</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function Connection({ name, status }: { name: string; status: IntegrationSnapshot['chrome'] }) {
  const label = !status.enabled ? 'Disabled' : status.connected ? 'Connected' : 'Not connected'
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 dark:bg-zinc-950">
      <span className="text-sm">{name}</span>
      <span className={`text-[12px] ${status.connected ? 'text-emerald-600' : 'text-zinc-500'}`}>{label}{status.lastSeen ? ` · ${new Date(status.lastSeen).toLocaleTimeString()}` : ''}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>{children}</label>
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1" />{label}</label>
}

function Status({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 dark:bg-zinc-950"><span>{label}</span><span className="text-[12px] uppercase tracking-wide text-zinc-500">{value}</span></div>
}

async function save(patch: Partial<SettingsData>, onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.updateSettings(patch)
  if (!result.ok) onError(result.error || 'Could not save settings.')
  else {
    onError(null)
    await onChange()
  }
}

async function saveShortcut(shortcut: string, onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.setShortcut(shortcut) as { ok: boolean; error?: string | null }
  if (!result.ok) onError(result.error || 'Could not register that shortcut.')
  else {
    onError(result.error ?? null)
    await onChange()
  }
}

async function saveKey(key: string, clear: (value: string) => void, onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.setApiKey(key)
  if (!result.ok) onError(result.error || 'Could not save the key.')
  else {
    clear('')
    onError(null)
    await onChange()
  }
}

async function clearKey(onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.clearApiKey()
  if (!result.ok) onError(result.error || 'Could not remove the key.')
  else {
    onError(null)
    await onChange()
  }
}

async function saveOddsKey(key: string, clear: (value: string) => void, onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.setOddsApiKey(key)
  if (!result.ok) onError(result.error || 'Could not save the Odds API key.')
  else {
    clear('')
    onError(null)
    await onChange()
  }
}

async function clearOddsKey(onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.clearOddsApiKey()
  if (!result.ok) onError(result.error || 'Could not remove the Odds API key.')
  else {
    onError(null)
    await onChange()
  }
}

async function rotate(onChange: () => Promise<void>, onError: (value: string | null) => void) {
  const result = await window.smartcursor.rotateToken()
  if (!result.ok) onError(result.error || 'Could not rotate the token.')
  else {
    onError(null)
    await onChange()
  }
}

function recordShortcut(event: KeyboardEvent<HTMLInputElement>, setShortcut: (value: string) => void) {
  if (['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) return
  event.preventDefault()
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
  parts.push(key)
  if (parts.length > 1) setShortcut(parts.join('+'))
}

const inputClass = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2 outline-none focus:border-amber-500 dark:border-white/10 dark:bg-zinc-950'
const selectClass = inputClass
const buttonClass = 'mt-2 rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] text-white dark:bg-white dark:text-zinc-900'
const quietButton = 'rounded-full bg-black/5 px-3 py-1.5 text-[12px] dark:bg-white/10'
