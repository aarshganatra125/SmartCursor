// Electron 45+ no longer downloads its binary during `npm install`; it waits until
// `require('electron')` is first called. electron-vite reads the binary path directly,
// so on a fresh install `npm run dev` fails with "Electron uninstall".
// This downloads the binary up front when it is missing.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function ensureElectronBinary() {
  const require = createRequire(import.meta.url)
  let root
  try {
    root = dirname(require.resolve('electron/package.json'))
  } catch {
    return
  }
  if (existsSync(join(root, 'path.txt'))) return
  console.log('Downloading the Electron binary…')
  const result = spawnSync(process.execPath, [join(root, 'install.js')], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('Electron could not be downloaded. Run `node node_modules/electron/install.js` and try again.')
    process.exit(result.status ?? 1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) ensureElectronBinary()
