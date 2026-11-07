import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'darwin') {
  console.log('SmartCursor native helper is built on macOS. Windows uses PowerShell integrations at runtime.')
  process.exit(0)
}

const source = join(root, 'native/macos/SmartCursorBridge.swift')
const output = join(root, 'native/macos/SmartCursorBridge')
const compiled = spawnSync(
  'swiftc',
  [
    '-O',
    '-o',
    output,
    source,
    '-framework',
    'Cocoa',
    '-framework',
    'Vision',
    '-framework',
    'ApplicationServices',
    '-framework',
    'CoreGraphics'
  ],
  { stdio: 'inherit' }
)

if (compiled.status !== 0) {
  process.exit(compiled.status ?? 1)
}

const signed = spawnSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' })
if (signed.status !== 0) {
  process.exit(signed.status ?? 1)
}

spawnSync('xattr', ['-dr', 'com.apple.quarantine', output], { stdio: 'ignore' })
console.log(`Built ${output}`)
