import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'

function readElectronVersion() {
  const require = createRequire(import.meta.url)
  const p = require.resolve('electron/package.json', { paths: [process.cwd()] })
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
  return pkg.version
}

function run(cmd, args, envPatch = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...envPatch }
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

const electronVersion = readElectronVersion()

console.log(`Rebuilding native deps for Electron ${electronVersion}...`)
try {
  // On passe par electron-rebuild pour rester aligné avec Electron.
  await run('npx', ['--no-install', 'electron-rebuild', '-f', '-w', 'better-sqlite3', '-v', electronVersion])
} catch (err) {
  const msg = String(err)
  const lockLikely =
    msg.includes('EBUSY') ||
    msg.includes('EPERM') ||
    msg.toLowerCase().includes('resource busy') ||
    msg.toLowerCase().includes('locked') ||
    msg.toLowerCase().includes('operation not permitted') ||
    msg.toLowerCase().includes('unlink')

  if (lockLikely) {
    console.warn(
      '[rebuild-electron] Native rebuild failed (file locked). Continuing.\n' +
        'Close any running Electron instance and run `npm run rebuild:electron` if the app fails to start.'
    )
    console.warn(msg)
    process.exit(0)
  }

  throw err
}
