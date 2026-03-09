import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('electron-vite/package.json', { paths: [process.cwd()] })
const cliPath = path.join(path.dirname(packageJsonPath), 'bin', 'electron-vite.js')
const args = process.argv.slice(2)
const env = { ...process.env }

delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cliPath, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env,
  windowsHide: false
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
