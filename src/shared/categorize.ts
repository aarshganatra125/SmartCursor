import type { AppCategory } from './types'

const TERMINALS = [
  'com.apple.terminal',
  'com.googlecode.iterm2',
  'dev.warp.warp',
  'co.zeit.hyper',
  'net.kovidgoyal.kitty',
  'org.alacritty',
  'com.github.wez.wezterm',
  'windowsterminal',
  'powershell',
  'pwsh',
  'cmd'
]

const EDITORS = [
  'com.microsoft.vscode',
  'com.todesktop',
  'com.sublimetext',
  'com.apple.dt.xcode',
  'com.jetbrains',
  'com.google.android.studio',
  'dev.zed.zed',
  'visual studio code',
  'vscode',
  'cursor',
  'sublime',
  'xcode',
  'intellij',
  'webstorm',
  'pycharm',
  'goland',
  'rubymine',
  'android studio',
  'neovim',
  'nova'
]

const BROWSERS = [
  'com.google.chrome',
  'com.apple.safari',
  'org.mozilla.firefox',
  'company.thebrowser.browser',
  'com.microsoft.edgemac',
  'com.brave.browser',
  'com.operasoftware.opera',
  'com.vivaldi',
  'chrome',
  'safari',
  'firefox',
  'microsoft edge',
  'brave',
  'arc'
]

const EMAIL = [
  'com.apple.mail',
  'com.microsoft.outlook',
  'com.readdle.spark',
  'mail',
  'outlook',
  'superhuman',
  'spark'
]

const DOCS = [
  'com.microsoft.word',
  'com.apple.iwork.pages',
  'com.apple.notes',
  'notion.id',
  'microsoft word',
  'winword',
  'pages',
  'notion',
  'notes',
  'google docs',
  'obsidian'
]

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

export function categorizeApp(name: string, bundleId = '', processHint = ''): AppCategory {
  const haystack = `${name} ${bundleId} ${processHint}`.toLowerCase()
  const processName = name.trim().toLowerCase()
  if (matches(haystack, TERMINALS) || haystack.includes('iterm') || processName === 'windowsterminal') return 'terminal'
  if (processName === 'code' || processName === 'code - insiders' || processName === 'cursor') return 'editor'
  if (matches(haystack, EDITORS)) return 'editor'
  if (matches(haystack, BROWSERS)) return 'browser'
  if (matches(haystack, EMAIL)) return 'email'
  if (matches(haystack, DOCS)) return 'document'
  return 'other'
}

export function isOwnApplication(name: string, bundleId = ''): boolean {
  const haystack = `${name} ${bundleId}`.toLowerCase()
  return (
    haystack.includes('smartcursor') ||
    name.toLowerCase() === 'electron' ||
    haystack.includes('com.github.electron')
  )
}
