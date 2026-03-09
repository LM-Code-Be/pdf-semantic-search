import { spawn } from 'node:child_process'

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function runCapture(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('exit', (code) => resolve({ code: code ?? 1, out, err }))
  })
}

const checkFirst = await runCapture(process.execPath, ['-e', "require('better-sqlite3'); console.log('better-sqlite3 ok')"])
if (checkFirst.code === 0) {
  console.log('Native deps already compatible with current Node.')
  process.exit(0)
}

console.log('Rebuilding native deps for current Node...')
await run('npm', ['rebuild', 'better-sqlite3'])
