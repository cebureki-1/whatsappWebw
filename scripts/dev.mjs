import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configs = ['vite.config.ts', 'vite.content.config.ts', 'vite.sw.config.ts']

function copyManifest() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
  const strip = (value) => {
    if (typeof value === 'string') return value.startsWith('dist/') ? value.slice(5) : value
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strip(item)]))
    }
    return value
  }
  writeFileSync(resolve(root, 'dist', 'manifest.json'), `${JSON.stringify(strip(manifest), null, 2)}\n`)
}

const children = configs.map((config) => {
  const child = spawn('npx', ['vite', 'build', '--config', config, '--watch'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  child.on('exit', (code) => {
    if (code && code !== 0) process.exit(code)
  })
  return child
})

copyManifest()
const timer = setInterval(copyManifest, 2000)
process.on('SIGINT', () => {
  clearInterval(timer)
  for (const child of children) child.kill('SIGINT')
  process.exit(0)
})
