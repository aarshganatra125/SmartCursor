// Runs electron-vite with a clean environment.
// VS Code tasks and some tools export ELECTRON_RUN_AS_NODE=1, which makes Electron
// start as plain Node (`require('electron').app` is undefined) and crashes on launch.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureElectronBinary } from './ensure-electron.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

ensureElectronBinary()

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: root })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
