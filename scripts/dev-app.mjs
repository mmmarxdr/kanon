import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shell = process.platform === 'win32'
const opts = { stdio: 'inherit', cwd: root, shell }

const api = spawn('pnpm', ['--filter', '@kanon/api', 'dev'], opts)
const web = spawn('pnpm', ['--filter', '@kanon/web', 'dev'], opts)
const children = [api, web]

let shuttingDown = false
/** @type {number | null} */
let exitCode = null

function killAll() {
  for (const ch of children) {
    if (ch.exitCode === null && ch.signalCode === null) {
      ch.kill()
    }
  }
}

let exited = 0
function onChildExit(code, signal) {
  exited++
  if (!shuttingDown) {
    shuttingDown = true
    exitCode = signal != null ? 1 : code ?? 1
    killAll()
  }
  if (exited >= children.length) {
    process.exit(exitCode ?? 0)
  }
}

api.on('exit', (code, signal) => onChildExit(code, signal))
web.on('exit', (code, signal) => onChildExit(code, signal))

function onParentSignal(unixCode) {
  if (!shuttingDown) {
    shuttingDown = true
    exitCode = process.platform === 'win32' ? 1 : unixCode
    killAll()
  }
}

process.on('SIGINT', () => onParentSignal(128 + 2))
process.on('SIGTERM', () => onParentSignal(128 + 15))
